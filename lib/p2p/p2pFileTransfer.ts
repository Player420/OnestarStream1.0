// lib/p2p/p2pFileTransfer.ts
// WebRTC-based P2P file transfer helper (client-side only).

'use client';

import {
  createSignalClient,
  SignalClient,
  ShareSignal,
  OfferSignal,
  AnswerSignal,
  IceCandidateSignal,
} from './signalClient';

export interface TransferProgress {
  sentBytes: number;
  totalBytes: number;
}

export interface SenderOptions {
  shareId: string;
  fromUserId: string;
  toUserId: string;
  file: File;
  signalUrl: string; // e.g. ws://137.184.46.163:4000 or wss://yourdomain:4000
  onProgress?: (progress: TransferProgress) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export interface ReceiverOptions {
  shareId: string;
  fromUserId: string;
  toUserId: string;
  signalUrl: string;
  onFileReceived?: (info: {
    blob: Blob;
    name: string;
    mimeType: string;
  }) => void;
  onError?: (error: Error) => void;
}

// ---------------
// SENDER
// ---------------
export async function startSender(opts: SenderOptions): Promise<void> {
  const {
    shareId,
    fromUserId,
    toUserId,
    file,
    signalUrl,
    onProgress,
    onComplete,
    onError,
  } = opts;

  try {
    if (typeof window === 'undefined') {
      throw new Error('startSender must be called in the browser');
    }

    const client: SignalClient = createSignalClient(signalUrl);

    // Loosen WebRTC typing to avoid TS noise while keeping behavior
    const pc = new RTCPeerConnection({
      iceServers: [], // you can add STUN/TURN later if needed
    }) as RTCPeerConnection;

    const channel = pc.createDataChannel('onestar-file') as RTCDataChannel;

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) return;

      const candidateSignal: IceCandidateSignal = {
        type: 'ice-candidate',
        shareId,
        fromUserId,
        toUserId,
        candidate: event.candidate.toJSON(),
      };

      client.send(candidateSignal);
    };

    client.onSignal(async (signal: ShareSignal) => {
      if (signal.shareId !== shareId) return;
      if (signal.fromUserId !== toUserId) return;

      if (signal.type === 'answer') {
        // Avoid RTCSessionDescription constructor; TS gets grumpy about it.
        await pc.setRemoteDescription(signal.sdp);
      } else if (signal.type === 'ice-candidate') {
        // Same: pass the init object directly.
        await pc.addIceCandidate(signal.candidate);
      }
    });

    channel.onopen = async () => {
      try {
        const totalBytes = file.size;
        let sentBytes = 0;

        // Send a small JSON header first
        const header = JSON.stringify({
          type: 'file-header',
          name: file.name,
          size: file.size,
          mimeType: file.type,
        });
        (channel as any).send(header);

        // Use the streaming File API, but don't let TS complain about it.
        const reader = (file as any).stream().getReader();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            const chunk = value as Uint8Array;
            sentBytes += chunk.byteLength;

            // TS is too strict about RTCDataChannel.send overloads; force it.
            (channel as any).send(chunk);

            if (onProgress) {
              onProgress({ sentBytes, totalBytes });
            }
          }
        }

        // EOF marker
        (channel as any).send(JSON.stringify({ type: 'file-end' }));

        if (onComplete) {
          onComplete();
        }

        // Optional: tell control plane the share is completed
        void fetch('/api/share/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ shareId, status: 'completed' }),
        });
      } catch (err) {
        if (onError) onError(err as Error);
      }
    };

    channel.onerror = (event) => {
      if (onError) {
        onError(new Error(`Data channel error: ${String(event)}`));
      }
    };

    // Create offer and send via signaling
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const offerSignal: OfferSignal = {
      type: 'offer',
      shareId,
      fromUserId,
      toUserId,
      sdp: offer,
    };

    client.send(offerSignal);
  } catch (err) {
    if (opts.onError) opts.onError(err as Error);
  }
}

// ---------------
// RECEIVER
// ---------------
export function startReceiver(opts: ReceiverOptions): void {
  const {
    shareId,
    fromUserId,
    toUserId,
    signalUrl,
    onFileReceived,
    onError,
  } = opts;

  try {
    if (typeof window === 'undefined') {
      throw new Error('startReceiver must be called in the browser');
    }

    const client: SignalClient = createSignalClient(signalUrl);

    const pc = new RTCPeerConnection({
      iceServers: [],
    }) as RTCPeerConnection;

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) return;

      const candidateSignal: IceCandidateSignal = {
        type: 'ice-candidate',
        shareId,
        fromUserId: toUserId, // receiver perspective
        toUserId: fromUserId,
        candidate: event.candidate.toJSON(),
      };

      client.send(candidateSignal);
    };

    pc.ondatachannel = (event: RTCDataChannelEvent) => {
      const channel = event.channel as RTCDataChannel;

      const chunks: Uint8Array[] = [];
      let header: { name: string; size: number; mimeType: string } | null = null;

      channel.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'file-header') {
              header = {
                name: msg.name as string,
                size: msg.size as number,
                mimeType: msg.mimeType as string,
              };
            } else if (msg.type === 'file-end') {
              const blob = new Blob(chunks as any, {
                type: header?.mimeType || 'application/octet-stream',
              });

              if (onFileReceived) {
                onFileReceived({
                  blob,
                  name: header?.name || 'download.bin',
                  mimeType: header?.mimeType || 'application/octet-stream',
                });
              }
            }
          } catch {
            // ignore bad JSON
          }
        } else {
          const data = ev.data as ArrayBuffer | Uint8Array | Blob;
          if (data instanceof ArrayBuffer) {
            chunks.push(new Uint8Array(data));
          } else if (data instanceof Uint8Array) {
            chunks.push(data);
          } else if (data instanceof Blob) {
            void data.arrayBuffer().then((buf) => {
              chunks.push(new Uint8Array(buf));
            });
          }
        }
      };

      channel.onerror = (event) => {
        if (onError) {
          onError(new Error(`Data channel error: ${String(event)}`));
        }
      };
    };

    client.onSignal(async (signal: ShareSignal) => {
      if (signal.shareId !== shareId) return;
      if (signal.fromUserId !== fromUserId) return;

      if (signal.type === 'offer') {
        // Same trick: use the init object directly instead of RTCSessionDescription
        await pc.setRemoteDescription(signal.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const answerSignal: AnswerSignal = {
          type: 'answer',
          shareId,
          fromUserId: toUserId, // receiver
          toUserId: fromUserId,
          sdp: answer,
        };
        client.send(answerSignal);
      } else if (signal.type === 'ice-candidate') {
        await pc.addIceCandidate(signal.candidate);
      }
    });
  } catch (err) {
    if (onError) onError(err as Error);
  }
}

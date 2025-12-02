// lib/p2p/signalClient.ts
// Typed WebSocket client for the signaling server.
// Use this only in browser components (call inside useEffect, etc.)

export type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'control';

export interface BaseSignal {
  shareId: string;
  fromUserId: string;
  toUserId: string;
  type: SignalType;
}

export interface OfferSignal extends BaseSignal {
  type: 'offer';
  sdp: RTCSessionDescriptionInit;
}

export interface AnswerSignal extends BaseSignal {
  type: 'answer';
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidateSignal extends BaseSignal {
  type: 'ice-candidate';
  candidate: RTCIceCandidateInit;
}

export interface ControlSignal extends BaseSignal {
  type: 'control';
  action: 'accept' | 'reject' | 'cancel';
}

export type ShareSignal =
  | OfferSignal
  | AnswerSignal
  | IceCandidateSignal
  | ControlSignal;

export type SignalHandler = (signal: ShareSignal) => void;

export interface SignalClient {
  socket: WebSocket;
  send: (signal: ShareSignal) => void;
  onSignal: (handler: SignalHandler) => void;
}

/**
 * Create a WebSocket client for the signaling server.
 * Call this from the browser only (e.g. inside a React useEffect).
 */
export function createSignalClient(url: string): SignalClient {
  if (typeof window === 'undefined') {
    throw new Error('createSignalClient must be called in the browser');
  }

  const socket = new WebSocket(url);
  const handlers: SignalHandler[] = [];

  socket.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse(event.data) as ShareSignal;
      handlers.forEach((h) => h(parsed));
    } catch {
      // Ignore invalid messages
    }
  });

  function send(signal: ShareSignal) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(signal));
    } else {
      // Optional: you can add queuing here if you want
      console.warn('Signal socket not open; dropping signal', signal);
    }
  }

  function onSignal(handler: SignalHandler) {
    handlers.push(handler);
  }

  return { socket, send, onSignal };
}

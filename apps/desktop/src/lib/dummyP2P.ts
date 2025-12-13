interface ReceiverOptions {
  shareId: string;
  fromUserId: string;
  toUserId: string;
  signalUrl: string;
  onFileReceived?: (data: { blob: Blob; name: string }) => void;
  onError?: (err: Error) => void;
}

export function startReceiver(_opts: ReceiverOptions): void {
  throw new Error("P2P module not implemented in this build");
}

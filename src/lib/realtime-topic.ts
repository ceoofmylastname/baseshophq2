// supabase-js keeps a registry of channels by topic; reusing the same topic
// across a StrictMode mount→unmount→remount returns the already-subscribed
// channel, and adding callbacks after subscribe() throws. Append a per-mount
// nonce so each effect run gets a fresh channel.
export function realtimeTopic(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

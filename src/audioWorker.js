// The modern era's launches built from their recordings (recordedTasks, AudioEngine.buildRecorded) off the
// main thread: plain Float32Array maths on the decoded recordings, a few tens of milliseconds a bank, which on the main
// thread stuttered the first seconds of a battle. Each bank goes back as soon as it is built, its channels copied into
// buffers of their own and transferred.
import { recordedTasks } from './audio.js';

self.onmessage = ({ data: { SR, rec } }) => {
  const make = (chans, sr) => ({ chans, sr });
  for (const [group, key, fn] of recordedTasks(SR, make, rec)) {
    const v = fn(), xfer = [];
    for (const s of v || []) {
      s.chans = s.chans.map((c) => c.slice());
      for (const c of s.chans) xfer.push(c.buffer);
    }
    self.postMessage({ group, key, v }, xfer);
  }
  self.postMessage({ done: true });
};

// https://github.com/tylerlong/node-webrtc-audio-stream-source

import wrtc from "@roamhq/wrtc";

class NodeWebRtcAudioStreamSource extends wrtc.nonstandard.RTCAudioSource {
  constructor() {
    super();
    this.streamEnd = true;
    this.cache = Buffer.alloc(0);
    this.isStopped = false;
  }

  stop() {
    this.isStopped = true;
    this.cache = Buffer.alloc(0);
    this.streamEnd = true;
    // this.stream?.end();
  }

  addStream(
    readable,
    {
      bitsPerSample = 16,
      sampleRate = 48000,
      channelCount = 1,
      requiredSamplesLen = 480,
      signal
    } = {}
  ) {
    if (signal?.aborted) {
      this.stop();
      return;
    }
    signal?.addEventListener("abort", () => {
      console.log("🛑 Aborting RtcAudioStreamSource!");
      this.stop();
    });

    this.isStopped = false;
    this.stream = readable;
    this.cache = Buffer.alloc(0);
    this.streamEnd = false;

    readable.on("data", (buffer) => {
      this.cache = Buffer.concat([this.cache, buffer]);
    });

    readable.on("end", () => {
      this.streamEnd = true;
    });

    const processData = () => {
      if (this.isStopped) return;

      try {
        const byteLength =
          ((sampleRate * bitsPerSample) / 8 / 100) * channelCount; // node-webrtc audio by default every 10ms, it is 1/100 second
        if (this.cache.length >= byteLength || this.streamEnd) {
          const buffer = this.cache.slice(0, byteLength);
          this.cache = this.cache.slice(byteLength);
          const samples = new Int16Array(new Uint8Array(buffer).buffer);

          if (samples.length === requiredSamplesLen) {
            this.onData({
              bitsPerSample,
              sampleRate,
              channelCount,
              numberOfFrames: samples.length,
              type: "data",
              samples
            });
          }
        }
        if (
          !this.isStopped &&
          (!this.streamEnd || this.cache.length >= byteLength)
        ) {
          setTimeout(() => processData(), 10); // every 10 ms, required by node-webrtc audio
        }
      } catch (error) {
        console.error(error);
      }
    };
    processData();
  }
}

export default NodeWebRtcAudioStreamSource;

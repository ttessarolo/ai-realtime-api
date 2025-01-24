import ffmpeg from "fluent-ffmpeg-7";
import { RTCPeerConnection, RTCRtpCodecParameters } from "werift";
import {
  WebmCallback,
  RtpSourceCallback,
  RtcpSourceCallback,
  NtpTimeCallback,
  DepacketizeCallback,
  DtxCallback
} from "werift/nonstandard";
import { WebSocketServer } from "ws";
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import vosk from "vosk";

vosk.setLogLevel(0);

const modelPath = "./models/vosk-model-it-0.22"; //"./models/vosk-model-small-it-0.22";
const model = new vosk.Model(modelPath);
const silent = Buffer.from([0xf8, 0xff, 0xfe]);
const server = new WebSocketServer({ port: 8888 });

function heartbeat() {
  this.isAlive = true;
}

const interval = setInterval(function ping() {
  server.clients.forEach(function each(socket) {
    if (socket.isAlive === false) return socket.terminate();

    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

server.on("close", function close() {
  clearInterval(interval);
});

server.on("connection", async (socket) => {
  socket.isAlive = true;
  socket.on("error", console.error);
  socket.on("pong", heartbeat);

  const input = new PassThrough();

  const pc = new RTCPeerConnection({
    codecs: {
      audio: [
        new RTCRtpCodecParameters({
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
          parameters: "usedtx=1"
        })
      ]
    }
  });

  pc.iceConnectionStateChange.subscribe((v) => {
    if (["disconnected"].includes(v)) {
      input.end();
    }
    console.log("pc.iceConnectionStateChange", v);
  });

  const channel = pc.createDataChannel("test");
  console.log("channel", channel);

  pc.onRemoteTransceiverAdded.subscribe((transceiver) => {
    console.log("onRemoteTransceiverAdded");
    transceiver.onTrack.subscribe((track) => {
      console.log("onRemoteTrack");
      transceiver.sender.replaceTrack(track);
    });
  });

  pc.addTransceiver("audio", { direction: "recvonly" }).onTrack.subscribe(
    (track) => {
      const audioBuffers = [];
      const webm = new WebmCallback(
        [
          {
            kind: "audio",
            codec: "OPUS",
            clockRate: 48000,
            trackNumber: 1
          }
        ],
        { duration: 1000 * 60 * 60 }
      );

      const audio = new RtpSourceCallback();
      const audioRtcp = new RtcpSourceCallback();
      {
        const ntpTime = new NtpTimeCallback(48000);
        const depacketizer = new DepacketizeCallback("opus");
        const dtx = new DtxCallback(20, silent);

        audio.pipe(ntpTime.input);
        audioRtcp.pipe(ntpTime.input);
        ntpTime.pipe(depacketizer.input);
        depacketizer.pipe(dtx.input);
        dtx.pipe(webm.inputAudio);
        // depacketizer.pipe(webm.inputAudio);
      }

      webm.pipe(async ({ saveToFile, kind }) => {
        input.push(saveToFile);
      });

      //input.on("data", console.log);
      const rec = new vosk.Recognizer({ model: model, sampleRate: 16000 });

      const audioStream = ffmpeg(input)
        .inputFormat("webm")
        .outputFormat("wav")
        .noVideo()
        .audioChannels(1)
        .audioBitrate("16k")
        .audioFrequency(16000)
        .audioQuality(0)
        // .duration(5)
        //.on("codecData", console.log)
        //.on("stderr", console.log)
        .on("progress", function (progress) {
          console.log("Processing: " + progress.timemark);
        })
        .on("end", async () => {
          console.log("Audio converted");
          const audio = Buffer.concat(audioBuffers);
          writeFileSync("./streamAudio.wav", audio);
        })
        .on("error", (err) => {
          console.error(err);
        })
        .stream({ end: true });

      audioStream.on("data", (chunk) => {
        const end_of_speech = rec.acceptWaveform(chunk);
        if (end_of_speech) {
          const result = rec.result()?.text; //.alternatives[0].result;
          if (result) channel.send(Buffer.from(result));
        }
        audioBuffers.push(chunk);
      });

      track.onReceiveRtp.subscribe(audio.input);
      track.onReceiveRtcp.subscribe(audioRtcp.input);
    }
  );

  await pc.setLocalDescription(await pc.createOffer());
  const sdp = JSON.stringify(pc.localDescription);
  socket.send(sdp);

  socket.on("message", async (data) => {
    const sdp = JSON.parse(data);
    console.log("signaling", sdp.type);
    await pc.setRemoteDescription(sdp);

    if (sdp.type === "offer") {
      await pc.setLocalDescription(await pc.createAnswer());
      socket.send(JSON.stringify(pc.localDescription));
    }
  });
});

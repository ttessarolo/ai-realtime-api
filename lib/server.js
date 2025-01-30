import { WebSocketServer } from "ws";
import wrtc from "@roamhq/wrtc";
import { PassThrough } from "node:stream";
import ffmpeg from "fluent-ffmpeg-7";
import vosk from "vosk";
import NodeWebRtcAudioStreamSource from "./nodeWebRtcAudioStreamSource.js";
import { speak } from "./piper/inference.js";

vosk.setLogLevel(0);

const { RTCAudioSink } = wrtc.nonstandard;
const modelPath = "./models/vosk-model-small-it-0.22"; //"./models/vosk-model-it-0.22";
const model = new vosk.Model(modelPath);
const server = new WebSocketServer({ port: 8888 });

server.on("connection", async (socket) => {
  socket.isAlive = true;
  console.log("connected");

  const pc = new wrtc.RTCPeerConnection({
    iceServers: []
  });

  socket.on("close", () => {
    console.log("closed");
    pc.close();
  });

  pc.onicecandidate = (event) => {
    if (!event.candidate) {
      console.log("Finished gathering ICE candidates");
    }
  };

  pc.oniceconnectionstatechange = (e) => {
    console.log("ice connection state change", pc.iceConnectionState);
    if (pc.iceConnectionState === "connected") {
    }
  };

  const channel = pc.createDataChannel("test");
  channel.onopen = () => {
    console.log("channel open");
    channel.send(
      Buffer.from("Prova a parlare ripeterò tutto quello che dici...")
    );
  };

  const source = new NodeWebRtcAudioStreamSource();
  const track = source.createTrack();
  pc.addTrack(track);

  pc.ontrack = (e) => {
    const rec = new vosk.Recognizer({ model: model, sampleRate: 16000 });
    const sink = new RTCAudioSink(e.track);
    const input = new PassThrough();

    const audioStream = ffmpeg(input)
      .addInputOptions(["-f s16le", "-ar 48k", "-ac 1"])
      .outputFormat("wav")
      .audioChannels(1)
      .audioBitrate("16k")
      .audioFrequency(16000)
      .on("error", console.error)
      .stream({ end: true });

    sink.ondata = ({ samples: { buffer } }) => {
      input.write(Buffer.from(buffer));
    };

    audioStream.on("data", (chunk) => {
      const end_of_speech = rec.acceptWaveform(chunk);
      if (end_of_speech) {
        const result = rec.result()?.text;
        if (result) {
          source.addStream(speak(result));
          channel.send(Buffer.from(result));
        }
      }
    });
  };

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

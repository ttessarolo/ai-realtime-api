import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { readFileSync } from "fs";
import { WebSocketServer } from "ws";
import wrtc from "@roamhq/wrtc";
import { PassThrough } from "node:stream";
import ffmpeg from "fluent-ffmpeg-7";
import vosk from "vosk";
import BlockStream from "block-stream2";
import VADBuilder, { VADMode } from "@ozymandiasthegreat/vad";
import NodeWebRtcAudioStreamSource from "./nodeWebRtcAudioStreamSource.js";
import { speakStream } from "./piper/inference.js";
import { chatStream, decide } from "./ollama.js";

vosk.setLogLevel(0);
global.process = process;

const { RTCAudioSink } = wrtc.nonstandard;
const VAD = await VADBuilder();
const modelPath = "./models/vosk-model-it-0.22"; //"./models/vosk-model-small-it-0.22";
const speakerPath = "./models/vosk-model-spk-0.4";
const model = new vosk.Model(modelPath);
//const speakerModel = new vosk.SpeakerModel(speakerPath);

const fastify = Fastify({
  https: {
    key: readFileSync("./certs/key.pem"),
    cert: readFileSync("./certs/cert.pem")
  }
});

fastify.register(fastifyCors, {
  origin: "*"
});

fastify.get("/", async (request, reply) => {
  reply
    .type("text/html")
    .send(readFileSync("./public/index.html").toString("utf-8"));
});

fastify.listen({ address: "127.0.0.1", port: 8888 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`🌎 Server listening at ${address}`);
});

const server = new WebSocketServer({ server: fastify.server });

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
    const vad = new VAD(VADMode.VERY_AGGRESSIVE, 16000); //VERY_AGGRESSIVE
    const vadStream = new BlockStream({
      size: vad.getMinBufferSize(1024 * 3),
      zeroPadding: false
    });

    let controller;

    //rec.setSpkModel(speakerModel);

    const audioStream = ffmpeg(input)
      .addInputOptions(["-f s16le", "-ar 48k", "-ac 1"])
      .outputFormat("wav")
      .audioChannels(1)
      .audioBitrate("16k")
      .audioFrequency(16000)
      .on("error", console.error)
      .stream({ end: true });

    sink.ondata = (data) => {
      const buffer = Buffer.from(data.samples.buffer);
      vadStream.write(buffer);
      input.write(buffer);
    };

    vadStream.on("data", (data) => {
      const vadResult = vad.processBuffer(new Int16Array(data.buffer));

      if (vadResult && controller) {
        channel.send(Buffer.from("🛑 ABORTING"));
        if (!controller.signal.aborted) {
          controller.abort();
        }
        controller = null;
      }
    });

    let listening = false;
    audioStream.on("data", (chunk) => {
      const end_of_speech = rec.acceptWaveform(chunk);
      if (end_of_speech) {
        if (listening) channel.send(Buffer.from("Stopped Listening..."));
        let result = rec.result()?.text;

        if (result) {
          listening = false;
          controller = new AbortController();
          const signal = controller.signal;
          channel.send(Buffer.from(result));

          decide(result, { signal })
            .then((response) => {
              channel.send(Buffer.from(response));
              switch (response) {
                case "CHAT": {
                  chatStream(result, {
                    signal,
                    onEnd: (response) => channel.send(Buffer.from(response))
                  })
                    .then((response) => {
                      const stream = speakStream(response, { signal });
                      source.addStream(stream, { signal });
                      stream.on("end", () => {
                        console.log("🪬🪬🪬🪬 Stream End");
                      });
                    })
                    .catch((e) => {
                      console.log("🤡 ChatStream Catch", e);
                    });
                  break;
                }
                case "STOP": {
                  controller.abort();
                  controller = null;
                  break;
                }
                case "OTHER": {
                  controller.abort();
                  controller = null;
                  break;
                }
              }
            })
            .catch((e) => {
              console.log("🤡 Decide Catch");
            });
        }
      } else {
        const { partial } = rec.partialResult();
        if (partial && !listening) {
          channel.send(Buffer.from("Listening..."));
          listening = true;
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

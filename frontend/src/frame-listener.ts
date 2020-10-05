import {
  CameraConnection,
  CameraConnectionState,
  Frame,
  PartialFrame
} from "@/camera";
// import { WasmTracingAllocator } from "@/tracing-allocator";
import cptvPlayer, { FrameHeaderV2 } from "../cptv-player";
import SmoothingWorker from "worker-loader!./smoothing-worker";
import { ImageInfo } from "@/smoothing-worker";

const { initWithCptvData, getRawFrame } = cptvPlayer as any;

const smoothingWorkers: Array<{
  worker: SmoothingWorker;
  pending: null | any;
  index: number;
}> = [
  {
    worker: new SmoothingWorker(),
    pending: null,
    index: 0
  }
];

for (let i = 0; i < smoothingWorkers.length; i++) {
  const s = smoothingWorkers[i];
  s.worker.onmessage = result => {
    if (s.pending) {
      // TODO(jon): See if we're ever getting frame number mis-matches here.
      (s.pending as any)(result.data);
      s.pending = null;
    } else {
      console.error("Couldn't find callback for", result.data, s.index);
    }
  };
}

let workerIndex = 0;

export const processSensorData = async (
  frame: PartialFrame
): Promise<ImageInfo> => {
  const index = workerIndex;
  return new Promise((resolve, reject) => {
    smoothingWorkers[index].pending = resolve as any;
    smoothingWorkers[index].worker.postMessage({
      frame: frame.frame,
      calibrationTempC: frame.frameInfo.Calibration.ThermalRefTemp
    });
  });
};

const workerContext: Worker = self as any;
let frameTimeout = 0;
let frameBuffer: Uint8Array | null = null;

export const InitialFrameInfo = {
  Camera: {
    ResX: 160,
    ResY: 120,
    FPS: 9,
    Brand: "flir",
    Model: "lepton3.5",
    Firmware: "3.3.26",
    CameraSerial: 12345
  },
  Telemetry: {
    FrameCount: 1,
    TimeOn: 1,
    FFCState: "On",
    FrameMean: 0,
    TempC: 0,
    LastFFCTempC: 0,
    LastFFCTime: 0
  },
  AppVersion: "",
  BinaryVersion: "",
  Calibration: {
    ThermalRefTemp: 38.66,
    SnapshotTime: 0,
    TemperatureCelsius: 36,
    SnapshotValue: 0,
    ThresholdMinFever: 0,
    Bottom: 0,
    Top: 0,
    Left: 0,
    Right: 0,
    CalibrationBinaryVersion: "fsdfd",
    UuidOfUpdater: 432423432432,
    UseErrorSound: true,
    UseWarningSound: true,
    UseNormalSound: true
  }
};

export interface FrameMessage {
  type: "connectionStateChange" | "gotFrame" | "noThermalReference" | "cptvFinished" ;
  payload: CameraConnectionState | Frame;
}

interface PlaybackCommand {
  useLiveCamera?: boolean;
  dumpMemoryAllocations?: boolean;
  hostname?: string;
  port?: string;
  cptvFileToPlayback?: string;
  startFrame?: number;
  endFrame?: number;
}

async function processFrame(frame: PartialFrame) {
  // console.log("got frame", frame);
  // Do the frame processing, then postMessage the relevant payload to the view app.
  // Do this in yet another worker(s)?
  performance.mark(`process frame ${frame.frameInfo.Telemetry.FrameCount}`);
  const imageInfo = await processSensorData(frame);
  performance.mark(`end frame ${frame.frameInfo.Telemetry.FrameCount}`);
  performance.measure(
    `frame ${frame.frameInfo.Telemetry.FrameCount}`,
    `start frame ${frame.frameInfo.Telemetry.FrameCount}`,
    `end frame ${frame.frameInfo.Telemetry.FrameCount}`
  );
  performance.measure(
    `process frame ${frame.frameInfo.Telemetry.FrameCount}`,
    `process frame ${frame.frameInfo.Telemetry.FrameCount}`,
    `end frame ${frame.frameInfo.Telemetry.FrameCount}`
  );

  workerContext.postMessage({
    type: "gotFrame",
    payload: {
      frameInfo: frame.frameInfo,
      frame: frame.frame,
      bodyShape: imageInfo.bodyShape,
      analysisResult: imageInfo.analysisResult
    } as Frame
  });
}

function onConnectionStateChange(connectionState: CameraConnectionState) {
  workerContext.postMessage({
    type: "connectionStateChange",
    payload: connectionState
  } as FrameMessage);
}

let prevFrame = -1;

function getNextFrame(startFrame = -1, endFrame = -1) {
  let frameInfo: FrameHeaderV2 = getRawFrame(frameBuffer);
  if (frameInfo.frame_number < prevFrame || (endFrame != -1 && frameInfo.frame_number > endFrame)) {
    workerContext.postMessage({
      type: "cptvFinished",
    });
    return;
  }
  while (frameInfo.frame_number < startFrame) {
    frameInfo = getRawFrame(frameBuffer);
  }
  prevFrame = frameInfo.frame_number;
  const appVersion = "";
  const binaryVersion = "";
  const currentFrame = {
    frame: new Uint16Array(frameBuffer!.buffer),
    frameInfo: {
      ...InitialFrameInfo,
      AppVersion: appVersion,
      BinaryVersion: binaryVersion,
      Telemetry: {
        ...InitialFrameInfo.Telemetry,
        LastFFCTime: frameInfo!.last_ffc_time,
        FrameCount: frameInfo!.frame_number,
        TimeOn: frameInfo!.time_on
      },
    }
  };
  frameInfo.free();
  frameTimeout = (setTimeout(getNextFrame, 1000 / 9, startFrame, endFrame) as unknown) as number;

  const frameNumber = currentFrame.frameInfo.Telemetry.FrameCount;
  if (frameNumber % 20 === 0) {
    performance.clearMarks();
    performance.clearMeasures();
    performance.clearResourceTimings();
  }
  performance.mark(`start frame ${frameNumber}`);

  processFrame(currentFrame);
}

function playLocalCptvFile(
  cptvFileBytes: ArrayBuffer,
  startFrame = 0,
  endFrame = -1
) {
  frameBuffer = new Uint8Array(160 * 120 * 2);
  initWithCptvData(new Uint8Array(cptvFileBytes));
  getNextFrame(startFrame, endFrame);
}

(async function run() {
  workerContext.addEventListener("message", async event => {
    const message = event.data as PlaybackCommand;
    if (message.useLiveCamera) {
      new CameraConnection(
        message.hostname!,
        message.port!,
        processFrame,
        onConnectionStateChange
      );
      // Init live camera web-socket connection
    } else if (message.cptvFileToPlayback) {

      // @ts-ignore
      console.log('Current directory: ' + process.cwd());
      // Init CPTV file playback
      await cptvPlayer(`${process.env.BASE_URL}cptv_player_bg.wasm`);
      const cptvFile = await fetch(message.cptvFileToPlayback);
      const buffer = await cptvFile.arrayBuffer();
      playLocalCptvFile(
        buffer,
        message.startFrame || 0,
        message.endFrame || -1
      );
    }
    return;
  });
})();

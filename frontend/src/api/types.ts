export enum TemperatureSource {
  FOREHEAD = "forehead",
  EAR = "ear",
  ARMPIT = "armpit",
  ORAL = "oral"
}

export enum Modes {
  CALIBRATE = "calibrate",
  SCAN = "scan"
}

export interface CalibrationInfo {
  ThermalRefTemp: number;
  SnapshotTime: number;
  TemperatureCelsius: number;
  SnapshotValue: number;
  SnapshotUncertainty: number;
  BodyLocation: string;
  ThresholdMinFever: number;
  Top: number;
  Left: number;
  Right: number;
  Bottom: number;
  CalibrationBinaryVersion: string;
  UuidOfUpdater: number;
}

export interface NetworkInterface {
  Name: string;
  IPAddresses: string[] | null;
}

export interface CameraInfo {
  Brand: string;
  Model: string;
  FPS: number;
  ResX: number;
  ResY: number;
  Firmware: string;
  CameraSerial: number;
}

export interface Telemetry {
  TimeOn: number;
  FFCState: string;
  FrameCount: number;
  FrameMean: number;
  TempC: number;
  LastFFCTempC: number;
  LastFFCTime: number;
}

export interface FrameInfo {
  Calibration: CalibrationInfo;
  Telemetry: Telemetry;
  AppVersion: string;
  BinaryVersion: string;
  Camera: CameraInfo;
}

export const Dummy = 1;

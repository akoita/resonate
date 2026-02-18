declare module "essentia.js" {
  export class Essentia {
    constructor(wasmModule: any);
    arrayToVector(array: Float32Array): any;
    RMS(vector: any): { rms: number };
    Spectrum(vector: any): { spectrum: any };
    SpectralCentroidTime(vector: any): { centroid: number };
    EnergyBandRatio(spectrum: any, sampleRate: number, startFreq: number, stopFreq: number): { energyBandRatio: number };
    StartStopSilence(vector: any): { startFrame: number; stopFrame: number };
  }
  export function EssentiaWASM(): Promise<any>;
}

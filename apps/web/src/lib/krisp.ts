// Anti-ruído da LiveKit (modelo Krisp, o mesmo tipo usado pelo Discord). Fica num
// arquivo próprio para virar um pacote separado (~6 MB), baixado só na hora da call.
export { KrispNoiseFilter, isKrispNoiseFilterSupported } from '@livekit/krisp-noise-filter';

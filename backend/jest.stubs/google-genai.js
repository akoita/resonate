// Jest stub for @google/genai — same ESM compatibility issue as @google/adk.
// Integration tests only need a constructible client with the small live music
// surface used by the generation services during Nest module bootstrap.
class GoogleGenAI {
  constructor(options = {}) {
    this.options = options;
    this.live = {
      music: {
        connect: async () => ({
          setWeightedPrompts: async () => {},
          setMusicGenerationConfig: async () => {},
          resetContext: async () => {},
          play: async () => {},
          stop: async () => {},
        }),
      },
    };
  }
}

module.exports = { GoogleGenAI };

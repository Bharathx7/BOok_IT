module.exports = {
  testEnvironment: "node",

  transform: {
    "^.+\\.tsx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: {
            syntax: "typescript",
            topLevelAwait: true
          },
          target: "es2022"
        },
        module: {
          type: "es6"
        }
      }
    ]
  },

  extensionsToTreatAsEsm: [".ts"],

  resolver: "<rootDir>/jest.resolver.cjs",

  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"]
};
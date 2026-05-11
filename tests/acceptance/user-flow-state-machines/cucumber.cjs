// Cucumber configuration.
// Tests run from inside this directory; ts-node/esm loader compiles TS on the
// fly so we don't need a pre-build step.

module.exports = {
  default: {
    paths: ["features/**/*.feature"],
    import: ["steps/**/*.ts"],
    loader: ["ts-node/esm"],
    format: ["progress-bar", "summary"],
    formatOptions: { snippetInterface: "async-await" },
    publishQuiet: true,
    // All scenarios except the walking skeleton are tagged @skip until
    // DELIVER enables them one-at-a-time per `roadmap.json`. (Skill rule:
    // one scenario enabled at a time.)
    tags: "not @skip",
  },
};

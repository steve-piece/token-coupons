// The one place the version number is written.
//
// This used to be read out of package.json, which stopped being true the day
// the tool became a skill rather than a published package: the skill directory
// is copied on its own by `skills add`, so anything it reads has to live inside
// it. A constant also means no filesystem read on a code path that runs on
// every command.
//
// The plugin manifest carries the same number for the plugin installer, and a
// test fails if the two ever drift apart.

export const VERSION = '0.1.0'

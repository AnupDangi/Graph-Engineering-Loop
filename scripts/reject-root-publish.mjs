#!/usr/bin/env node

console.error(
  "Refusing to publish the monorepo root. Publish only an explicitly selected package workspace."
);
process.exit(1);

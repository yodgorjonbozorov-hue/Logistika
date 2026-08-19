/*
 * Vercel Function entry for the API.
 *
 * This file stays plain JavaScript on purpose. Vercel's Node builder transpiles
 * an entrypoint with esbuild, which strips TypeScript types without emitting the
 * `design:paramtypes` metadata NestJS needs for dependency injection. So the
 * whole application is compiled ahead of time by `nest build` (tsc, with
 * `emitDecoratorMetadata`) and this shim just forwards to the compiled handler —
 * a static `require` the file tracer follows when it bundles the function.
 */
'use strict';

const { default: handler } = require('../dist/serverless');

module.exports = handler;

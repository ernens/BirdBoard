'use strict';
/**
 * Audio routes — dispatcher.
 *
 * The actual handlers live in server/routes/audio/ split by concern:
 *   _helpers       — shared utilities (jsonConfigGet/Post, paths, whitelists)
 *   streaming      — audio-info, audio-stream, live-stream, live-pcm
 *   devices        — config, devices enum, audio test, hardware boost
 *   profiles       — preset CRUD + activate
 *   calibration    — inter-channel gain matching wizard
 *   monitoring     — SSE VU meter, filter preview
 *   adaptive_gain  — endpoints + background collector
 *   noise_profile  — ambient-noise capture for spectral subtraction
 *
 * Each module exports `handle(req, res, pathname, ctx)` returning `true` if
 * it claimed the request. We try them in declaration order; first match wins.
 *
 * Only `adaptive_gain` has lifecycle state (interval timer + arecord child)
 * and exposes a `shutdown()` we forward at the dispatcher level.
 */
const streaming     = require('./audio/streaming');
const devices       = require('./audio/devices');
const profiles      = require('./audio/profiles');
const calibration   = require('./audio/calibration');
const monitoring    = require('./audio/monitoring');
const adaptiveGain  = require('./audio/adaptive_gain');
const noiseProfile  = require('./audio/noise_profile');

const MODULES = [
  streaming, devices, profiles, calibration,
  monitoring, adaptiveGain, noiseProfile,
];

function handle(req, res, pathname, ctx) {
  for (const mod of MODULES) {
    if (mod.handle(req, res, pathname, ctx)) return true;
  }
  return false;
}

function shutdown() {
  adaptiveGain.shutdown();
}

module.exports = { handle, shutdown };

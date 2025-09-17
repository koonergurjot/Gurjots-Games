### Quick wins this week (low effort, high impact)

- **Input buffering + coyote time**
  - Add a 120–150 ms input buffer for jump/roll.
  - Allow 100–120 ms coyote window after leaving ground.

- **Hit‑pause + screen shake**
  - 80–120 ms hit‑pause on crit/heavy impacts; unscaled time.
  - Subtle 1–3% camera kick with fast decay; clamp during cinematics.

- **Faster time‑to‑fun**
  - Skip nonessential pre‑play UI.
  - 1‑tap retry/restart; auto‑equip best gear on start.

- **Early‑game tuning**
  - Reduce early enemy HP by 15–25%.
  - Clear telegraphs; reduce chain stun/slow via diminishing returns.

- **UI readability and inputs**
  - Increase font sizes (≥26 px) and contrast (≥7:1 for key text).
  - Remap primary action to most comfortable inputs across KBM/gamepad.

- **Performance and stability**
  - Lock frame pacing (60 fps target with vsync/smoothing).
  - Compress large textures (crunch/BCn) and audio (Vorbis ~0.45 quality).
  - Fix top crashers first; guard null/destroyed references and async timeouts.

### Acceptance criteria

- Time‑to‑first‑action < 60 s from launch on target device.
- Input latency budget < 80 ms end‑to‑end.
- Level‑1 clear rate ≥ 70%; reduced early TTK variance.
- Crash‑free sessions ≥ 99.5% on latest build.
- Stable frame time at 16.7 ms p95; variance < 2 ms.

### Engineering notes (Unity/Unreal/Godot)

- Unity: add input buffer + coyote in `InputBuffer` component; `Time.timeScale` hit‑pause; small `Camera` kick with LERP decay; set `Application.targetFrameRate = 60` and `vSyncCount = 1`; import settings for texture/audio compression.
- Unreal: track `LastPress`/`LastGrounded`; use `SetGlobalTimeDilation(0)` for hit‑pause; enable Smooth Frame Rate 60–60; use BCn textures and Vorbis audio.
- Godot: track timestamps; `Engine.time_scale = 0` for hit‑pause; decay `Camera2D.offset` for kick.

### Telemetry to verify impact

- Funnel: install → first action → first win → first upgrade → session end.
- Metrics: p50/p95 frame time, crash rate, early TTK, level‑1 clear rate, retries.

### Rollout plan

1. Implement input buffer, coyote, hit‑pause, and camera kick.
2. Trim boot flow; add 1‑tap retry; auto‑equip best.
3. Tune early enemy HP and telegraphs; add stun DR.
4. UI pass on font sizes/contrast; input remaps.
5. Frame pacing + compression; fix top crashers.
6. Ship A/B on early HP and reward amounts; monitor metrics for 72 hours.


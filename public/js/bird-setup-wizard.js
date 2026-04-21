/**
 * bird-setup-wizard.js — first-run setup wizard modal
 *
 * Loads after bird-vue-core.js. Exposes:
 *   BIRDASH.SetupWizard      — Vue component
 *   BIRDASH.openSetupWizard()— manual trigger (called by Settings button)
 *   BIRDASH.checkSetupStatus()— returns Promise<{needed, …}> from /api/setup/status
 *
 * Phase 1 surface: Welcome → Location → Recap. P2 adds Audio + Model,
 * P3 adds Filters + Integrations + first-launch auto-trigger.
 *
 * The wizard state lives in a single reactive object exposed on BIRDASH
 * so any page that includes `<setup-wizard>` shares the same instance —
 * makes the "redo wizard" button work from any page.
 */
(function (Vue, BIRDASH) {
  'use strict';
  const { reactive, ref, computed, onMounted } = Vue;
  const { useI18n } = BIRDASH;

  // ── Global wizard state (single instance shared across pages) ──────────
  const state = reactive({
    open: false,
    step: 0,
    hardware: null,
    loading: false,
    applying: false,
    results: null,
    errors: [],
    // Accumulated user choices — defaults populated when we open the
    // wizard (so reopening starts fresh from current config).
    choices: {
      location:     { latitude: null, longitude: null },
      audio:        { device_id: '', device_name: '' },
      model:        { primary: '', secondary: null, dual: false },
      filters:      { privacy: true, dog: false },
      integrations: { birdweather_station_id: '', apprise_urls: [] },
    },
  });

  // Steps order. P3 will splice 'filters' and 'integrations' between
  // 'model' and 'recap'. Each step has: key (for i18n), required (cannot skip).
  const STEPS = [
    { key: 'welcome',      required: false },
    { key: 'location',     required: true  },
    { key: 'audio',        required: true  },
    { key: 'model',        required: true  },
    { key: 'filters',      required: false },
    { key: 'integrations', required: false },
    { key: 'recap',        required: false },
  ];

  // Available models cache — populated lazily on first wizard open.
  // Used by the "advanced model picker" toggle on the model step.
  const availableModels = ref([]);
  async function loadAvailableModels() {
    if (availableModels.value.length) return;
    try {
      const r = await fetch('/birds/api/models');
      if (r.ok) {
        const data = await r.json();
        availableModels.value = data.models || [];
      }
    } catch {}
  }

  // ── API helpers ────────────────────────────────────────────────────────
  async function checkSetupStatus() {
    try {
      const r = await fetch('/birds/api/setup/status');
      if (!r.ok) return { needed: false };
      return await r.json();
    } catch { return { needed: false }; }
  }

  async function loadHardware() {
    state.loading = true;
    try {
      const r = await fetch('/birds/api/setup/hardware-profile');
      if (r.ok) {
        state.hardware = await r.json();
        // Seed audio + model defaults from hardware recommendations,
        // but only if the user hasn't already changed those fields
        // (preloadCurrentConfig may have set them from current config).
        const hw = state.hardware;
        if (hw?.audio?.devices?.length && !state.choices.audio.device_id) {
          const idx = hw.audio.recommended >= 0 ? hw.audio.recommended : 0;
          const dev = hw.audio.devices[idx];
          state.choices.audio.device_id = dev.cardId;
          state.choices.audio.device_name = dev.desc || dev.name;
        }
        if (hw?.recommendations?.models && !state.choices.model.primary) {
          const rec = hw.recommendations.models;
          state.choices.model.primary = rec.primary;
          state.choices.model.secondary = rec.secondary;
          state.choices.model.dual = rec.dual;
        }
      }
    } catch { state.hardware = null; }
    state.loading = false;
  }

  // Pre-populate from current BirdNET config so re-runs show current
  // values instead of empty fields. Hardware-detected defaults only kick
  // in if these are empty (e.g. fresh install).
  async function preloadCurrentConfig() {
    try {
      const r = await fetch('/birds/api/settings');
      if (!r.ok) return;
      const conf = await r.json();
      const lat = parseFloat(conf.LATITUDE || conf.latitude || '0');
      const lon = parseFloat(conf.LONGITUDE || conf.longitude || '0');
      if (!isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
        state.choices.location.latitude = lat;
        state.choices.location.longitude = lon;
      }
      if (conf.MODEL || conf.model) {
        state.choices.model.primary = conf.MODEL || conf.model;
        state.choices.model.dual = String(conf.DUAL_MODEL_ENABLED || '0') === '1';
        state.choices.model.secondary = conf.SECONDARY_MODEL || null;
      }
      // Pre-filters and BirdWeather are also in birdnet.conf
      if ('YAMNET_PRIVACY_FILTER' in conf) {
        state.choices.filters.privacy = String(conf.YAMNET_PRIVACY_FILTER) === '1';
      }
      if ('YAMNET_DOG_FILTER' in conf) {
        state.choices.filters.dog = String(conf.YAMNET_DOG_FILTER) === '1';
      }
      if (conf.BIRDWEATHER_ID) {
        state.choices.integrations.birdweather_station_id = conf.BIRDWEATHER_ID;
      }
    } catch {}
    // Load current audio device too
    try {
      const r = await fetch('/birds/api/audio/config');
      if (r.ok) {
        const cfg = await r.json();
        if (cfg.device_id) {
          state.choices.audio.device_id = cfg.device_id;
          state.choices.audio.device_name = cfg.device_name || '';
        }
      }
    } catch {}
    // Load current Apprise URLs
    try {
      const r = await fetch('/birds/api/apprise');
      if (r.ok) {
        const data = await r.json();
        if (data.urls) {
          state.choices.integrations.apprise_urls = data.urls.split('\n').map(s => s.trim()).filter(Boolean);
        }
      }
    } catch {}
  }

  async function applyChoices() {
    state.applying = true;
    state.results = null;
    state.errors = [];
    try {
      const r = await fetch('/birds/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.choices),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        state.errors.push(data.message || data.error || 'apply_failed');
      } else {
        state.results = data.results;
      }
    } catch (e) {
      state.errors.push(e.message || 'network_error');
    }
    state.applying = false;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  async function openSetupWizard() {
    state.step = 0;
    state.results = null;
    state.errors = [];
    state.open = true;
    // Load hardware + current config + available models in parallel;
    // wizard renders the welcome step immediately and the data lands
    // before the user reaches steps that need it.
    // Order matters: preload config first so its values aren't overwritten
    // by the hardware defaults.
    await preloadCurrentConfig();
    await Promise.all([loadHardware(), loadAvailableModels()]);
  }

  function closeWizard(force = false) {
    if (!force && state.applying) return;
    state.open = false;
    // Suppress auto-reopen for the rest of this browser session. Cleared
    // on tab close. Manual reopen via openSetupWizard() always works.
    try { sessionStorage.setItem('birdash_wizard_dismissed', '1'); } catch {}
  }

  function nextStep() {
    if (state.step < STEPS.length - 1) state.step++;
  }
  function prevStep() {
    if (state.step > 0) state.step--;
  }

  // ── Component ──────────────────────────────────────────────────────────
  const SetupWizard = {
    setup() {
      const { t } = useI18n();

      const currentStep = computed(() => STEPS[state.step] || STEPS[0]);
      const isFirst = computed(() => state.step === 0);
      const isLast = computed(() => state.step === STEPS.length - 1);
      const stepNum = computed(() => state.step + 1);
      const totalSteps = computed(() => STEPS.length);

      // Validation per step — disables Next when the step has
      // a required field that's not yet filled.
      const canAdvance = computed(() => {
        const k = currentStep.value.key;
        if (k === 'location') {
          const lat = state.choices.location.latitude;
          const lon = state.choices.location.longitude;
          return typeof lat === 'number' && typeof lon === 'number'
              && !isNaN(lat) && !isNaN(lon)
              && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
              && (lat !== 0 || lon !== 0);
        }
        if (k === 'audio') return !!state.choices.audio.device_id;
        if (k === 'model') {
          const m = state.choices.model;
          if (!m.primary) return false;
          if (m.dual && !m.secondary) return false;
          return true;
        }
        return true;
      });

      // Hardware summary used in welcome + recap steps for context.
      const hwSummary = computed(() => {
        const hw = state.hardware;
        if (!hw) return null;
        return {
          piModel: hw.pi?.model || '?',
          ram: hw.ram?.gb ? `${hw.ram.gb} GB RAM` : '',
          audio: hw.audio?.devices?.[0]?.desc || (hw.audio?.devices?.length ? hw.audio.devices[0].name : t('setup_no_audio_detected')),
          internet: hw.internet ? t('setup_online') : t('setup_offline'),
        };
      });

      // Human-friendly model label for the recap (uses BIRDASH.shortModel
      // if available, falls back to the raw identifier).
      function shortModelLabel(id) {
        if (!id) return '—';
        return (BIRDASH.shortModel && BIRDASH.shortModel(id)) || id;
      }

      // Recap building blocks — show only what the user actually configured.
      const recapItems = computed(() => {
        const items = [];
        const c = state.choices;
        if (typeof c.location.latitude === 'number') {
          items.push({
            key: 'location',
            label: t('setup_step_location'),
            value: `${c.location.latitude.toFixed(4)}, ${c.location.longitude.toFixed(4)}`,
          });
        }
        if (c.audio.device_id) {
          items.push({
            key: 'audio',
            label: t('setup_step_audio'),
            value: c.audio.device_name || c.audio.device_id,
          });
        }
        if (c.model.primary) {
          const value = c.model.dual && c.model.secondary
            ? `${shortModelLabel(c.model.primary)} + ${shortModelLabel(c.model.secondary)}`
            : shortModelLabel(c.model.primary);
          items.push({
            key: 'model',
            label: t('setup_step_model'),
            value,
          });
        }
        // Filters: only show if anything is enabled
        const fParts = [];
        if (c.filters.privacy) fParts.push(t('setup_filter_privacy_title'));
        if (c.filters.dog)     fParts.push(t('setup_filter_dog_title'));
        if (fParts.length) {
          items.push({ key: 'filters', label: t('setup_step_filters'), value: fParts.join(', ') });
        }
        // Integrations: same — only show if user filled something
        const iParts = [];
        if (c.integrations.birdweather_station_id) {
          iParts.push(`BirdWeather #${c.integrations.birdweather_station_id}`);
        }
        if (c.integrations.apprise_urls.length) {
          iParts.push(`Apprise (${c.integrations.apprise_urls.length})`);
        }
        if (iParts.length) {
          items.push({ key: 'integrations', label: t('setup_step_integrations'), value: iParts.join(', ') });
        }
        return items;
      });

      // Toggle exposing the full model picker (secondary list) — folded
      // by default to keep the simple "recommended" choice front-and-center.
      const advancedModel = ref(false);

      // Apprise URLs are stored as an array internally, but the textarea
      // works on a single string. Two-way binding via a computed wouldn't
      // play nicely with v-model + onInput, so we expose a ref that mirrors
      // the array and watch the textarea's input event to sync the array.
      const appriseText = computed({
        get() { return (state.choices.integrations.apprise_urls || []).join('\n'); },
        set(v) { state.choices.integrations.apprise_urls = v.split(/\n/).map(s => s.trim()).filter(Boolean); },
      });
      // For the secondary model picker, exclude the primary from the list.
      const availableModelsForSecondary = computed(() => {
        return availableModels.value.filter(m => m !== state.choices.model.primary);
      });

      async function onApply() {
        await applyChoices();
        // If apply succeeded, jump to the final "done" view; the user
        // closes manually when they've read the results.
      }

      function tryClose() {
        if (state.applying) return;
        if (state.results) { closeWizard(true); return; }
        // Confirm if the user has filled anything but not applied
        const hasInput = typeof state.choices.location.latitude === 'number';
        if (hasInput && !confirm(t('setup_confirm_close'))) return;
        closeWizard();
      }

      return {
        state, t, currentStep, isFirst, isLast, stepNum, totalSteps,
        canAdvance, hwSummary, recapItems,
        availableModels, availableModelsForSecondary,
        advancedModel, shortModelLabel, appriseText,
        nextStep, prevStep, onApply, tryClose,
      };
    },
    template: `
<div v-if="state.open" class="sw-overlay" @click.self="tryClose" role="dialog" aria-modal="true">
  <div class="sw-modal">
    <header class="sw-header">
      <div>
        <div class="sw-title">{{t('setup_title')}}</div>
        <div class="sw-step-label">{{t('setup_step_' + currentStep.key)}}</div>
      </div>
      <button class="sw-close" @click="tryClose" :aria-label="t('close')">×</button>
    </header>

    <div class="sw-progress">
      <div class="sw-progress-bar" :style="{width: (stepNum / totalSteps * 100) + '%'}"></div>
      <div class="sw-progress-text">{{stepNum}} / {{totalSteps}}</div>
    </div>

    <main class="sw-body">
      <!-- ── Welcome ─────────────────────────────────────────── -->
      <section v-if="currentStep.key === 'welcome'">
        <h2 class="sw-h2">{{t('setup_welcome_title')}}</h2>
        <p class="sw-p">{{t('setup_welcome_intro')}}</p>
        <ul class="sw-list">
          <li>{{t('setup_welcome_will_set_location')}}</li>
          <li>{{t('setup_welcome_will_set_audio')}}</li>
          <li>{{t('setup_welcome_will_set_model')}}</li>
          <li>{{t('setup_welcome_will_set_filters')}}</li>
          <li>{{t('setup_welcome_will_set_integrations')}}</li>
        </ul>
        <div v-if="state.loading" class="sw-loading">
          <span class="spinner-inline"><i></i><i></i><i></i></span>
          {{t('setup_detecting_hardware')}}
        </div>
        <div v-else-if="hwSummary" class="sw-hw-card">
          <div class="sw-hw-title">{{t('setup_detected_hardware')}}</div>
          <div class="sw-hw-row"><span class="sw-hw-lbl">{{t('setup_hw_pi')}}</span><span>{{hwSummary.piModel}} · {{hwSummary.ram}}</span></div>
          <div class="sw-hw-row"><span class="sw-hw-lbl">{{t('setup_hw_audio')}}</span><span>{{hwSummary.audio}}</span></div>
          <div class="sw-hw-row"><span class="sw-hw-lbl">{{t('setup_hw_internet')}}</span><span>{{hwSummary.internet}}</span></div>
        </div>
      </section>

      <!-- ── Location ────────────────────────────────────────── -->
      <section v-else-if="currentStep.key === 'location'">
        <h2 class="sw-h2">{{t('setup_step_location')}}</h2>
        <p class="sw-p">{{t('setup_location_desc')}}</p>
        <details class="sw-why">
          <summary>{{t('setup_why_this_matters')}}</summary>
          <p>{{t('setup_location_why')}}</p>
        </details>
        <div class="sw-form-row">
          <label>{{t('setup_latitude')}}
            <input type="number" v-model.number="state.choices.location.latitude"
                   step="0.0001" min="-90" max="90" placeholder="50.85">
          </label>
          <label>{{t('setup_longitude')}}
            <input type="number" v-model.number="state.choices.location.longitude"
                   step="0.0001" min="-180" max="180" placeholder="4.35">
          </label>
        </div>
        <div class="sw-hint">{{t('setup_location_hint')}}</div>
      </section>

      <!-- ── Audio source ────────────────────────────────────── -->
      <section v-else-if="currentStep.key === 'audio'">
        <h2 class="sw-h2">{{t('setup_step_audio')}}</h2>
        <p class="sw-p">{{t('setup_audio_desc')}}</p>
        <details class="sw-why">
          <summary>{{t('setup_why_this_matters')}}</summary>
          <p>{{t('setup_audio_why')}}</p>
        </details>
        <div v-if="state.loading" class="sw-loading">
          <span class="spinner-inline"><i></i><i></i><i></i></span>
          {{t('setup_detecting_hardware')}}
        </div>
        <div v-else-if="!state.hardware?.audio?.devices?.length" class="sw-warning">
          {{t('setup_no_audio_detected')}}
        </div>
        <div v-else class="sw-device-list">
          <label v-for="(d, i) in state.hardware.audio.devices" :key="d.cardId"
                 class="sw-device" :class="{'sw-device-active': state.choices.audio.device_id === d.cardId}">
            <input type="radio" :value="d.cardId" v-model="state.choices.audio.device_id"
                   @change="state.choices.audio.device_name = d.desc || d.name">
            <div class="sw-device-info">
              <div class="sw-device-name">
                {{d.desc || d.name}}
                <span v-if="i === state.hardware.audio.recommended" class="sw-rec-badge">{{t('setup_recommended')}}</span>
                <span v-if="d.kind === 'usb'" class="sw-kind-badge sw-kind-usb">USB</span>
                <span v-else-if="d.kind === 'builtin'" class="sw-kind-badge sw-kind-builtin">{{t('setup_audio_builtin')}}</span>
              </div>
              <div class="sw-device-meta">{{d.cardId}}</div>
            </div>
          </label>
        </div>
        <div class="sw-hint">{{t('setup_audio_hint')}}</div>
      </section>

      <!-- ── Detection model ─────────────────────────────────── -->
      <section v-else-if="currentStep.key === 'model'">
        <h2 class="sw-h2">{{t('setup_step_model')}}</h2>
        <p class="sw-p">{{t('setup_model_desc')}}</p>
        <details class="sw-why">
          <summary>{{t('setup_why_this_matters')}}</summary>
          <p>{{t('setup_model_why')}}</p>
        </details>

        <!-- Recommended preset (single vs dual) -->
        <div class="sw-model-presets">
          <label class="sw-model-preset" :class="{'sw-model-preset-active': !state.choices.model.dual}">
            <input type="radio" :checked="!state.choices.model.dual"
                   @change="state.choices.model.dual = false; state.choices.model.secondary = null">
            <div class="sw-model-preset-info">
              <div class="sw-model-preset-title">{{t('setup_model_single_title')}}</div>
              <div class="sw-model-preset-sub">{{t('setup_model_single_sub')}}</div>
            </div>
          </label>
          <label class="sw-model-preset" :class="{'sw-model-preset-active': state.choices.model.dual}">
            <input type="radio" :checked="state.choices.model.dual"
                   @change="state.choices.model.dual = true; if (!state.choices.model.secondary && state.hardware?.recommendations?.models?.secondary) state.choices.model.secondary = state.hardware.recommendations.models.secondary">
            <div class="sw-model-preset-info">
              <div class="sw-model-preset-title">{{t('setup_model_dual_title')}}</div>
              <div class="sw-model-preset-sub">{{t('setup_model_dual_sub')}}</div>
            </div>
          </label>
        </div>

        <div class="sw-hw-card" style="margin-top:.6rem;" v-if="state.hardware?.recommendations?.models">
          <div class="sw-hw-title">{{t('setup_recommended_for_your_hardware')}}</div>
          <div class="sw-hw-row">
            <span class="sw-hw-lbl">{{t('setup_model_primary')}}</span>
            <span>{{shortModelLabel(state.hardware.recommendations.models.primary)}}</span>
          </div>
          <div v-if="state.hardware.recommendations.models.secondary" class="sw-hw-row">
            <span class="sw-hw-lbl">{{t('setup_model_secondary')}}</span>
            <span>{{shortModelLabel(state.hardware.recommendations.models.secondary)}} ({{t('setup_model_dual')}})</span>
          </div>
        </div>

        <!-- Advanced picker -->
        <details class="sw-advanced" :open="advancedModel" @toggle="advancedModel = $event.target.open">
          <summary>{{t('setup_model_advanced')}}</summary>
          <div class="sw-form-row" style="grid-template-columns: 1fr;">
            <label>{{t('setup_model_primary')}}
              <select v-model="state.choices.model.primary">
                <option v-for="m in availableModels" :key="m" :value="m">{{shortModelLabel(m)}}</option>
              </select>
            </label>
            <label v-if="state.choices.model.dual">{{t('setup_model_secondary')}}
              <select v-model="state.choices.model.secondary">
                <option :value="null">—</option>
                <option v-for="m in availableModelsForSecondary" :key="m" :value="m">{{shortModelLabel(m)}}</option>
              </select>
            </label>
          </div>
        </details>
      </section>

      <!-- ── Pre-filters ─────────────────────────────────────── -->
      <section v-else-if="currentStep.key === 'filters'">
        <h2 class="sw-h2">{{t('setup_step_filters')}}</h2>
        <p class="sw-p">{{t('setup_filters_desc')}}</p>
        <details class="sw-why">
          <summary>{{t('setup_why_this_matters')}}</summary>
          <p>{{t('setup_filters_why')}}</p>
        </details>
        <div class="sw-filter-rows">
          <label class="sw-filter-row">
            <input type="checkbox" v-model="state.choices.filters.privacy">
            <div>
              <div class="sw-filter-title">{{t('setup_filter_privacy_title')}}</div>
              <div class="sw-filter-sub">{{t('setup_filter_privacy_sub')}}</div>
            </div>
          </label>
          <label class="sw-filter-row">
            <input type="checkbox" v-model="state.choices.filters.dog">
            <div>
              <div class="sw-filter-title">{{t('setup_filter_dog_title')}}</div>
              <div class="sw-filter-sub">{{t('setup_filter_dog_sub')}}</div>
            </div>
          </label>
        </div>
      </section>

      <!-- ── Integrations ────────────────────────────────────── -->
      <section v-else-if="currentStep.key === 'integrations'">
        <h2 class="sw-h2">{{t('setup_step_integrations')}}</h2>
        <p class="sw-p">{{t('setup_integrations_desc')}}</p>
        <details class="sw-why">
          <summary>{{t('setup_why_this_matters')}}</summary>
          <p>{{t('setup_integrations_why')}}</p>
        </details>

        <div class="sw-integration-block">
          <div class="sw-integration-title">
            <bird-icon name="radio" :size="14"></bird-icon>
            {{t('setup_integration_birdweather')}}
            <span class="sw-optional-tag">{{t('setup_optional')}}</span>
          </div>
          <p class="sw-integration-desc">{{t('setup_integration_birdweather_desc')}}</p>
          <input type="text" v-model.trim="state.choices.integrations.birdweather_station_id"
                 :placeholder="t('setup_integration_birdweather_placeholder')"
                 class="sw-integration-input">
        </div>

        <div class="sw-integration-block">
          <div class="sw-integration-title">
            <bird-icon name="bell" :size="14"></bird-icon>
            {{t('setup_integration_apprise')}}
            <span class="sw-optional-tag">{{t('setup_optional')}}</span>
          </div>
          <p class="sw-integration-desc">{{t('setup_integration_apprise_desc')}}</p>
          <textarea v-model="appriseText" rows="4"
                    :placeholder="t('setup_integration_apprise_placeholder')"
                    class="sw-integration-input sw-integration-textarea"></textarea>
        </div>

        <p class="sw-hint">{{t('setup_integrations_skip_hint')}}</p>
      </section>

      <!-- ── Recap ───────────────────────────────────────────── -->
      <section v-else-if="currentStep.key === 'recap'">
        <h2 class="sw-h2">{{t('setup_recap_title')}}</h2>
        <p v-if="!state.results && !state.errors.length" class="sw-p">{{t('setup_recap_intro')}}</p>
        <div v-if="!state.results && !state.errors.length" class="sw-restart-note">
          <bird-icon name="info" :size="13"></bird-icon>
          {{t('setup_recap_no_restart')}}
        </div>
        <div v-if="recapItems.length" class="sw-recap-list">
          <div v-for="r in recapItems" :key="r.key" class="sw-recap-row">
            <span class="sw-recap-lbl">{{r.label}}</span>
            <span class="sw-recap-val">{{r.value}}</span>
          </div>
        </div>
        <div v-if="state.applying" class="sw-loading">
          <span class="spinner-inline"><i></i><i></i><i></i></span>
          {{t('setup_applying')}}
        </div>
        <div v-if="state.results" class="sw-results">
          <div class="sw-results-title">{{t('setup_done_title')}}</div>
          <ul>
            <li v-for="(v, k) in state.results" :key="k">
              <strong>{{k}}</strong>: {{v}}
            </li>
          </ul>
          <p class="sw-p">{{t('setup_done_restart_hint')}}</p>
        </div>
        <div v-if="state.errors.length" class="sw-errors">
          <div class="sw-errors-title">{{t('setup_apply_errors')}}</div>
          <ul><li v-for="(e, i) in state.errors" :key="i">{{e}}</li></ul>
        </div>
      </section>
    </main>

    <footer class="sw-footer">
      <button v-if="!state.results" class="sw-btn sw-btn-ghost" @click="prevStep" :disabled="isFirst || state.applying">
        ← {{t('setup_back')}}
      </button>
      <span class="sw-spacer"></span>
      <button v-if="state.results" class="sw-btn sw-btn-primary" @click="tryClose">
        {{t('close')}}
      </button>
      <button v-else-if="!isLast" class="sw-btn sw-btn-primary" @click="nextStep" :disabled="!canAdvance">
        {{t('setup_next')}} →
      </button>
      <button v-else class="sw-btn sw-btn-primary" @click="onApply" :disabled="state.applying">
        {{state.applying ? t('setup_applying') : t('setup_apply')}}
      </button>
    </footer>
  </div>
</div>`,
  };

  // ── Register ──────────────────────────────────────────────────────────
  BIRDASH.SetupWizard = SetupWizard;
  BIRDASH.openSetupWizard = openSetupWizard;
  BIRDASH.checkSetupStatus = checkSetupStatus;
  BIRDASH._setupWizardState = state;

  // Patch registerComponents so app.use() picks up <setup-wizard>.
  const _origRegister = BIRDASH.registerComponents;
  if (_origRegister) {
    BIRDASH.registerComponents = function (app) {
      const ret = _origRegister(app);
      app.component('setup-wizard', SetupWizard);
      return ret || app;
    };
  }
})(window.Vue, window.BIRDASH);

'use strict';

/**
 * Smart Dehumidifier plugin.
 *
 * Automates a dehumidifier by monitoring a humidity sensor, controlling a
 * power switch, and optionally detecting a full water tank via a power meter.
 *
 * ### Logic overview
 *
 * 1. When **enabled** and humidity > targetHumidity + hysteresis → turn ON
 * 2. When humidity < targetHumidity → turn OFF
 * 3. While the switch is ON and measured power drops below
 *    `tankFullPowerThreshold` for longer than `tankFullDelay` seconds →
 *    declare **tank full**, turn OFF
 * 4. When a user re-enables the device after a tank-full event → reset the
 *    alarm
 *
 * @module smart-dehumidifier
 */

// ---------------------------------------------------------------------------
// Internal per-device runtime state (not persisted)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DehumidifierState
 * @property {number|null} lowPowerSince   - Timestamp when low-power condition was first detected.
 * @property {boolean}     commandedOn     - Whether the switch was commanded ON by this plugin.
 * @property {ReturnType<typeof setInterval>|null} intervalHandle - Interval handle.
 */

/** @type {Map<string, DehumidifierState>} */
const runtimeState = new Map();

/**
 * @param {string} deviceId
 * @returns {DehumidifierState}
 */
function getRuntime(deviceId) {
    let s = runtimeState.get(deviceId);
    if (!s) {
        s = { lowPowerSince: null, commandedOn: false, intervalHandle: null };
        runtimeState.set(deviceId, s);
    }
    return s;
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

class SmartDehumidifierPlugin {
    constructor() {
        // -- Identity ----------------------------------------------------------

        /** @type {string} */
        this.id = 'smart-dehumidifier';

        /** @type {Record<string,string>} */
        this.name = {
            en: 'Smart Dehumidifier',
            de: 'Intelligenter Entfeuchter',
        };

        /** @type {Record<string,string>} */
        this.description = {
            en: 'Automatic dehumidifier control with humidity target, tank-full detection, and power monitoring',
            de: 'Automatische Entfeuchtersteuerung mit Feuchtigkeitsziel, Tank-voll-Erkennung und Leistungsüberwachung',
        };

        // -- Input slots -------------------------------------------------------

        /** @type {import('../lib/plugin-interface').InputSlot[]} */
        this.inputSlots = [
            {
                id: 'humiditySensor',
                name: { en: 'Humidity Sensor', de: 'Feuchtigkeitssensor' },
                description: {
                    en: 'The humidity sensor to monitor (e.g., from a Zigbee or Z-Wave sensor)',
                    de: 'Der zu überwachende Feuchtigkeitssensor (z.B. von einem Zigbee- oder Z-Wave-Sensor)',
                },
                required: true,
                filter: {
                    type: 'state',
                    common: {
                        type: 'number',
                        role: ['value.humidity'],
                    },
                },
            },
            {
                id: 'powerSwitch',
                name: { en: 'Power Switch', de: 'Netzschalter' },
                description: {
                    en: 'The switch that controls the dehumidifier power (on/off)',
                    de: 'Der Schalter, der den Entfeuchter ein-/ausschaltet',
                },
                required: true,
                filter: {
                    type: 'state',
                    common: {
                        type: 'boolean',
                        role: ['switch', 'switch.power'],
                    },
                },
            },
            {
                id: 'powerMeter',
                name: { en: 'Power Meter', de: 'Leistungsmesser' },
                description: {
                    en: 'Power consumption sensor for tank-full detection (optional but recommended)',
                    de: 'Leistungsverbrauchssensor für Tank-voll-Erkennung (optional, aber empfohlen)',
                },
                required: false,
                filter: {
                    type: 'state',
                    common: {
                        type: 'number',
                        role: ['value.power'],
                        unit: ['W'],
                    },
                },
            },
        ];

        // -- Config schema (JSONConfig fragments) ------------------------------

        /** @type {Record<string, import('../lib/plugin-interface').JsonConfigItem>} */
        this.configSchema = {
            targetHumidity: {
                type: 'number',
                label: { en: 'Target Humidity (%)', de: 'Ziel-Luftfeuchtigkeit (%)' },
                min: 30,
                max: 80,
            },
            humidityHysteresis: {
                type: 'number',
                label: { en: 'Hysteresis (%)', de: 'Hysterese (%)' },
                min: 1,
                max: 10,
            },
            tankFullPowerThreshold: {
                type: 'number',
                label: { en: 'Tank full power threshold (W)', de: 'Tank-voll Leistungsschwelle (W)' },
                min: 0,
                max: 50,
            },
            tankFullDelay: {
                type: 'number',
                label: { en: 'Tank full detection delay (s)', de: 'Tank-voll Erkennungsverzögerung (s)' },
                min: 10,
                max: 600,
            },
            scheduleStart: {
                type: 'text',
                label: { en: 'Allowed from (HH:MM)', de: 'Erlaubt ab (HH:MM)' },
                help: {
                    en: 'Start time for automatic operation. Leave empty for 24/7. Overnight windows supported (e.g. 22:00–06:00).',
                    de: 'Startzeit für Automatikbetrieb. Leer lassen für 24/7. Über-Nacht-Fenster möglich (z.B. 22:00–06:00).',
                },
                maxLength: 5,
            },
            scheduleEnd: {
                type: 'text',
                label: { en: 'Allowed until (HH:MM)', de: 'Erlaubt bis (HH:MM)' },
                help: {
                    en: 'End time for automatic operation. Leave empty for 24/7.',
                    de: 'Endzeit für Automatikbetrieb. Leer lassen für 24/7.',
                },
                maxLength: 5,
            },
            scheduleMon: {
                type: 'checkbox',
                label: { en: 'Monday', de: 'Montag' },
            },
            scheduleTue: {
                type: 'checkbox',
                label: { en: 'Tuesday', de: 'Dienstag' },
            },
            scheduleWed: {
                type: 'checkbox',
                label: { en: 'Wednesday', de: 'Mittwoch' },
            },
            scheduleThu: {
                type: 'checkbox',
                label: { en: 'Thursday', de: 'Donnerstag' },
            },
            scheduleFri: {
                type: 'checkbox',
                label: { en: 'Friday', de: 'Freitag' },
            },
            scheduleSat: {
                type: 'checkbox',
                label: { en: 'Saturday', de: 'Samstag' },
            },
            scheduleSun: {
                type: 'checkbox',
                label: { en: 'Sunday', de: 'Sonntag' },
            },
        };

        /** @type {Record<string, any>} */
        this.configDefaults = {
            targetHumidity: 55,
            humidityHysteresis: 3,
            tankFullPowerThreshold: 5,
            tankFullDelay: 60,
            scheduleStart: '',
            scheduleEnd: '',
            scheduleMon: true,
            scheduleTue: true,
            scheduleWed: true,
            scheduleThu: true,
            scheduleFri: true,
            scheduleSat: true,
            scheduleSun: true,
        };

        // -- Output states -----------------------------------------------------

        /** @type {import('../lib/plugin-interface').OutputStateDefinition[]} */
        this.outputStates = [
            {
                id: 'running',
                name: { en: 'Running', de: 'Läuft' },
                type: 'boolean',
                role: 'indicator.working',
                read: true,
                write: false,
            },
            {
                id: 'humidity',
                name: { en: 'Humidity', de: 'Luftfeuchtigkeit' },
                type: 'number',
                role: 'value.humidity',
                unit: '%',
                read: true,
                write: false,
                min: 0,
                max: 100,
            },
            {
                id: 'power',
                name: { en: 'Power', de: 'Leistung' },
                type: 'number',
                role: 'value.power',
                unit: 'W',
                read: true,
                write: false,
                min: 0,
            },
            {
                id: 'tankFull',
                name: { en: 'Tank Full', de: 'Tank voll' },
                type: 'boolean',
                role: 'indicator.alarm',
                read: true,
                write: false,
            },
            {
                id: 'enabled',
                name: { en: 'Automatic control', de: 'Automatische Steuerung' },
                description: {
                    en: 'Enable/disable automatic dehumidifier control',
                    de: 'Automatische Entfeuchtersteuerung ein-/ausschalten',
                },
                type: 'boolean',
                role: 'switch.enable',
                read: true,
                write: true,
            },
        ];
    }

    // ======================================================================
    // Lifecycle
    // ======================================================================

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @returns {Promise<void>}
     */
    async onInit(ctx) {
        const rt = getRuntime(ctx.deviceId);
        rt.lowPowerSince = null;
        rt.commandedOn = false;

        // Default output states
        await ctx.setOutputState('running', false, true);
        await ctx.setOutputState('tankFull', false, true);

        // Default enabled to true on first start if not yet set
        const enabledState = await ctx.getOutputState('enabled');
        if (enabledState === null || enabledState.val === null) {
            await ctx.setOutputState('enabled', true, true);
        }

        // Read current input values to initialise outputs
        const humState = await ctx.getInputState('humiditySensor');
        if (humState?.val !== null && humState?.val !== undefined) {
            await ctx.setOutputState('humidity', Number(humState.val), true);
        }

        const powerState = await ctx.getInputState('powerMeter');
        if (powerState?.val !== null && powerState?.val !== undefined) {
            await ctx.setOutputState('power', Number(powerState.val), true);
        }

        // Start periodic interval for tank-full detection
        rt.intervalHandle = setInterval(() => {
            this.onInterval(ctx).catch((e) => ctx.log.error(`Interval error: ${e}`));
        }, 10_000);

        ctx.log.info(`Smart dehumidifier "${ctx.deviceId}" initialised`);
    }

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {string} inputId
     * @param {object|null} state
     * @returns {Promise<void>}
     */
    async onInputChange(ctx, inputId, state) {
        if (!state || state.val === null || state.val === undefined) return;

        switch (inputId) {
            case 'humiditySensor':
                await this._handleHumidityChange(ctx, Number(state.val));
                break;

            case 'powerMeter':
                await this._handlePowerChange(ctx, Number(state.val));
                break;

            case 'powerSwitch':
                // Track external switch changes
                await ctx.setOutputState('running', Boolean(state.val), true);
                break;
        }
    }

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @returns {Promise<void>}
     */
    async onInterval(ctx) {
        const rt = getRuntime(ctx.deviceId);

        // Turn off if schedule window has ended
        if (rt.commandedOn && !this._isWithinSchedule(ctx)) {
            ctx.log.info(`Schedule window ended for "${ctx.deviceId}" — turning OFF`);
            await this._setSwitchState(ctx, false);
            return;
        }

        if (!rt.commandedOn) return;

        // Check for tank-full condition via sustained low power
        if (!ctx.inputs.powerMeter) return;

        const powerState = await ctx.getInputState('powerMeter');
        if (!powerState || powerState.val === null || powerState.val === undefined) return;

        const power = Number(powerState.val);
        const threshold = Number(ctx.config.tankFullPowerThreshold ?? 5);
        const delay = Number(ctx.config.tankFullDelay ?? 60) * 1000;

        if (power < threshold) {
            if (rt.lowPowerSince === null) {
                rt.lowPowerSince = Date.now();
            } else if (Date.now() - rt.lowPowerSince >= delay) {
                // Tank is full
                ctx.log.warn(`Tank full detected for "${ctx.deviceId}" — power ${power}W below ${threshold}W for >${ctx.config.tankFullDelay}s`);
                await ctx.setOutputState('tankFull', true, true);
                await this._setSwitchState(ctx, false);
            }
        } else {
            rt.lowPowerSince = null;
        }
    }

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @returns {Promise<void>}
     */
    async onDestroy(ctx) {
        const rt = runtimeState.get(ctx.deviceId);
        if (rt?.intervalHandle) {
            clearInterval(rt.intervalHandle);
        }
        runtimeState.delete(ctx.deviceId);
        ctx.log.info(`Smart dehumidifier "${ctx.deviceId}" destroyed`);
    }

    // ======================================================================
    // Private logic
    // ======================================================================

    /**
     * Check if the current time is within the configured schedule window.
     * Returns true if no schedule is configured (empty = 24/7).
     * Supports overnight windows (e.g. 22:00–06:00).
     *
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @returns {boolean}
     */
    _isWithinSchedule(ctx) {
        const startStr = String(ctx.config.scheduleStart || '').trim();
        const endStr = String(ctx.config.scheduleEnd || '').trim();

        // Day-of-week check: map JS getDay() (0=Sun..6=Sat) to config keys
        const dayKeys = ['scheduleSun', 'scheduleMon', 'scheduleTue', 'scheduleWed', 'scheduleThu', 'scheduleFri', 'scheduleSat'];
        const now = new Date();
        const todayKey = dayKeys[now.getDay()];

        // If all days are true (or unset) → no day restriction
        const anyDayConfigured = dayKeys.some((k) => ctx.config[k] === false);
        if (anyDayConfigured) {
            if (ctx.config[todayKey] === false) return false;
        }

        // No time schedule configured → allowed (day check already passed)
        if (!startStr || !endStr) return true;

        const match = (s) => s.match(/^(\d{1,2}):(\d{2})$/);
        const startMatch = match(startStr);
        const endMatch = match(endStr);
        if (!startMatch || !endMatch) return true; // invalid format → allow

        const currentMin = now.getHours() * 60 + now.getMinutes();
        const startMin = parseInt(startMatch[1], 10) * 60 + parseInt(startMatch[2], 10);
        const endMin = parseInt(endMatch[1], 10) * 60 + parseInt(endMatch[2], 10);

        if (startMin <= endMin) {
            // Normal window: e.g. 08:00–20:00
            return currentMin >= startMin && currentMin < endMin;
        } else {
            // Overnight window: e.g. 22:00–06:00
            return currentMin >= startMin || currentMin < endMin;
        }
    }

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {number} humidity
     * @returns {Promise<void>}
     */
    async _handleHumidityChange(ctx, humidity) {
        await ctx.setOutputState('humidity', humidity, true);

        const enabled = await ctx.getOutputState('enabled');
        if (!enabled || enabled.val !== true) return;

        const tankFull = await ctx.getOutputState('tankFull');
        if (tankFull?.val === true) return;

        const target = Number(ctx.config.targetHumidity ?? 55);
        const hysteresis = Number(ctx.config.humidityHysteresis ?? 3);
        const rt = getRuntime(ctx.deviceId);
        const inSchedule = this._isWithinSchedule(ctx);

        if (humidity > target + hysteresis && !rt.commandedOn && inSchedule) {
            ctx.log.info(`Humidity ${humidity}% > ${target + hysteresis}% — turning ON`);
            await this._setSwitchState(ctx, true);
        } else if (humidity < target && rt.commandedOn) {
            ctx.log.info(`Humidity ${humidity}% < ${target}% — turning OFF`);
            await this._setSwitchState(ctx, false);
        } else if (!inSchedule && rt.commandedOn) {
            ctx.log.info(`Outside schedule window — turning OFF`);
            await this._setSwitchState(ctx, false);
        }
    }

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {number} power
     * @returns {Promise<void>}
     */
    async _handlePowerChange(ctx, power) {
        await ctx.setOutputState('power', power, true);

        const rt = getRuntime(ctx.deviceId);
        const threshold = Number(ctx.config.tankFullPowerThreshold ?? 5);

        // Reset low-power timer if power is above threshold
        if (power >= threshold) {
            rt.lowPowerSince = null;
        }
    }

    /**
     * Command the physical power switch and update runtime/output state.
     *
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {boolean} on
     * @returns {Promise<void>}
     */
    async _setSwitchState(ctx, on) {
        const rt = getRuntime(ctx.deviceId);
        rt.commandedOn = on;

        if (ctx.inputs.powerSwitch) {
            await ctx.adapter.setForeignStateAsync(ctx.inputs.powerSwitch, on, false);
        }

        await ctx.setOutputState('running', on, true);

        if (!on) {
            rt.lowPowerSince = null;
        }
    }
}

module.exports = { SmartDehumidifierPlugin };

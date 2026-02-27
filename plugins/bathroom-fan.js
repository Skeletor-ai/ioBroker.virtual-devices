'use strict';

/**
 * Bathroom Fan plugin.
 *
 * Automates a bathroom exhaust fan based on humidity and presence+door conditions.
 *
 * ### Logic overview
 *
 * 1. **Humidity trigger:** When humidity > threshold → fan ON. When humidity < threshold - hysteresis → fan OFF.
 * 2. **Presence trigger:** When presence == activeValue AND door == closedValue → fan ON.
 *    When either condition breaks → fan OFF.
 * 3. **Priority:** If both triggers are active and a speed value is configured,
 *    the higher value wins (fanSpeedValue for humidity, fanOnValue for presence).
 * 4. **Off-delay:** After all triggers clear, the fan runs for `offDelay` more seconds.
 *
 * All actuator values are configurable (no boolean/type assumptions).
 *
 * @module bathroom-fan
 */

// ---------------------------------------------------------------------------
// Per-device runtime state (not persisted across restarts)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FanRuntime
 * @property {boolean}     humidityTrigger  - Humidity condition is active.
 * @property {boolean}     presenceTrigger  - Presence+door condition is active.
 * @property {ReturnType<typeof setTimeout>|null} offTimer - Delayed-off timer handle.
 * @property {any}         lastCommandValue - Last value written to fanCommand.
 * @property {import('../lib/action-chain').ActionChainExecutor|null} activeChainExecutor - Currently running chain.
 */

/** @type {Map<string, FanRuntime>} */
const runtimeState = new Map();

/**
 * @param {string} deviceId
 * @returns {FanRuntime}
 */
function getRuntime(deviceId) {
    let s = runtimeState.get(deviceId);
    if (!s) {
        s = { humidityTrigger: false, presenceTrigger: false, offTimer: null, lastCommandValue: null, activeChainExecutor: null };
        runtimeState.set(deviceId, s);
    }
    return s;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Loose comparison that handles string/number/boolean mixing from config values.
 * Handles cases like boolean `true` vs string `'true'`, number `1` vs string `'1'`, etc.
 * @param {any} actual
 * @param {any} expected
 * @returns {boolean}
 */
/**
 * Parse a config value string into its native type.
 * 'true'/'false' → boolean, numeric strings → number, otherwise string as-is.
 * @param {any} val
 * @returns {any}
 */
function parseConfigValue(val) {
    if (val === '' || val === null || val === undefined) return val;
    const s = String(val).trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
    const n = Number(val);
    if (!isNaN(n) && String(val).trim() !== '') return n;
    return String(val);
}

function looseEquals(actual, expected) {
    // eslint-disable-next-line eqeqeq
    if (actual == expected) return true;
    // Handle boolean<->string: true/'true', false/'false'
    const strActual = String(actual).toLowerCase();
    const strExpected = String(expected).toLowerCase();
    return strActual === strExpected;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

class BathroomFanPlugin {
    constructor() {
        /** @type {string} */
        this.id = 'bathroom-fan';

        /** @type {Record<string,string>} */
        this.name = {
            en: 'Bathroom Fan',
            de: 'Badlüfter',
        };

        /** @type {Record<string,string>} */
        this.description = {
            en: 'Automatic bathroom fan control based on humidity and presence with configurable actuator values',
            de: 'Automatische Badlüfter-Steuerung über Feuchtigkeit und Präsenz mit konfigurierbaren Aktor-Werten',
        };

        // -- Input slots -------------------------------------------------------

        /** @type {import('../lib/plugin-interface').InputSlot[]} */
        this.inputSlots = [
            {
                id: 'humiditySensor',
                name: { en: 'Humidity Sensor', de: 'Feuchtigkeitssensor' },
                description: {
                    en: 'Humidity sensor in the bathroom (%)',
                    de: 'Feuchtigkeitssensor im Bad (%)',
                },
                required: true,
                filter: {
                    type: 'state',
                    common: { type: 'number', role: ['value.humidity'] },
                },
            },
            {
                id: 'fanCommand',
                name: { en: 'Fan Command', de: 'Lüfter Befehl' },
                description: {
                    en: 'Command datapoint to control the fan (write)',
                    de: 'Befehls-Datenpunkt zum Steuern des Lüfters (schreibend)',
                },
                required: true,
                filter: {
                    type: 'state',
                    common: { type: 'number' },
                },
            },
            {
                id: 'fanStatus',
                name: { en: 'Fan Status', de: 'Lüfter Status' },
                description: {
                    en: 'Status datapoint that reports the current fan state (read)',
                    de: 'Status-Datenpunkt der den aktuellen Lüfter-Zustand meldet (lesend)',
                },
                required: true,
                filter: {
                    type: 'state',
                    common: { type: 'number' },
                },
            },
            {
                id: 'presenceSensor',
                name: { en: 'Presence Sensor', de: 'Präsenzmelder' },
                description: {
                    en: 'Presence/motion sensor in the bathroom (optional)',
                    de: 'Präsenz-/Bewegungsmelder im Bad (optional)',
                },
                required: false,
                filter: { type: 'state' },
            },
            {
                id: 'doorContact',
                name: { en: 'Door Contact', de: 'Türkontakt' },
                description: {
                    en: 'Door contact sensor (optional, needed for presence trigger)',
                    de: 'Türkontakt-Sensor (optional, nötig für Präsenz-Trigger)',
                },
                required: false,
                filter: { type: 'state' },
            },
        ];

        // -- Config schema -----------------------------------------------------

        /** @type {Record<string, import('../lib/plugin-interface').JsonConfigItem>} */
        this.configSchema = {
            humidityThreshold: {
                type: 'number',
                label: { en: 'Humidity Threshold (%)', de: 'Feuchtigkeitsschwelle (%)' },
                min: 30,
                max: 95,
            },
            humidityHysteresis: {
                type: 'number',
                label: { en: 'Hysteresis (%)', de: 'Hysterese (%)' },
                min: 1,
                max: 20,
            },
            fanOnValue: {
                type: 'text',
                label: { en: 'Fan ON value (command)', de: 'Lüfter AN Wert (Befehl)' },
            },
            fanOffValue: {
                type: 'text',
                label: { en: 'Fan OFF value (command)', de: 'Lüfter AUS Wert (Befehl)' },
            },
            fanSpeedValue: {
                type: 'text',
                label: { en: 'Fan speed value (optional, for humidity)', de: 'Lüfter Drehzahl-Wert (optional, für Feuchtigkeit)' },
            },
            statusOnValue: {
                type: 'text',
                label: { en: 'Status ON value', de: 'Status AN Wert' },
            },
            statusOffValue: {
                type: 'text',
                label: { en: 'Status OFF value', de: 'Status AUS Wert' },
            },
            presenceActiveValue: {
                type: 'text',
                label: { en: 'Presence active value', de: 'Präsenz aktiv Wert' },
            },
            doorClosedValue: {
                type: 'text',
                label: { en: 'Door closed value', de: 'Tür geschlossen Wert' },
            },
            offDelay: {
                type: 'number',
                label: { en: 'Off delay (seconds)', de: 'Nachlaufzeit (Sekunden)' },
                min: 0,
                max: 3600,
            },
        };

        /** @type {Record<string, any>} */
        this.configDefaults = {
            humidityThreshold: 65,
            humidityHysteresis: 5,
            fanOnValue: '1',
            fanOffValue: '0',
            fanSpeedValue: '',
            statusOnValue: '1',
            statusOffValue: '0',
            presenceActiveValue: 'true',
            doorClosedValue: 'false',
            offDelay: 120,
        };

        // -- Action chain slots ------------------------------------------------

        /** @type {Record<string, import('../lib/plugin-interface').ActionChainSlot>} */
        this.actionChainSlots = {
            on: {
                name: { en: 'ON Chain', de: 'AN-Kette' },
                description: { en: 'Commands to turn the fan on (executed sequentially)', de: 'Befehle zum Einschalten des Lüfters (sequentiell ausgeführt)' },
            },
            off: {
                name: { en: 'OFF Chain', de: 'AUS-Kette' },
                description: { en: 'Commands to turn the fan off (executed sequentially)', de: 'Befehle zum Ausschalten des Lüfters (sequentiell ausgeführt)' },
            },
        };

        // -- Output states -----------------------------------------------------

        /** @type {import('../lib/plugin-interface').OutputStateDefinition[]} */
        this.outputStates = [
            {
                id: 'active',
                name: { en: 'Active', de: 'Aktiv' },
                type: 'boolean',
                role: 'indicator.working',
                read: true,
                write: false,
            },
            {
                id: 'trigger',
                name: { en: 'Trigger', de: 'Auslöser' },
                type: 'string',
                role: 'text',
                read: true,
                write: false,
            },
            {
                id: 'enabled',
                name: { en: 'Automatic control', de: 'Automatische Steuerung' },
                description: {
                    en: 'Enable/disable automatic fan control',
                    de: 'Automatische Lüftersteuerung ein-/ausschalten',
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
        rt.humidityTrigger = false;
        rt.presenceTrigger = false;
        rt.offTimer = null;
        rt.lastCommandValue = null;

        // Default output states
        await ctx.setOutputState('active', false, true);
        await ctx.setOutputState('trigger', 'none', true);

        const enabledState = await ctx.getOutputState('enabled');
        if (enabledState === null || enabledState.val === null) {
            await ctx.setOutputState('enabled', true, true);
        }

        // Evaluate current inputs on start
        const humState = await ctx.getInputState('humiditySensor');
        if (humState?.val !== null && humState?.val !== undefined) {
            await this._evaluateHumidity(ctx, Number(humState.val));
        }

        await this._evaluatePresence(ctx);
        await this._applyDesiredState(ctx);

        ctx.log.info(`Bathroom fan "${ctx.deviceId}" initialised`);
    }

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {string} inputId
     * @param {object|null} state
     * @returns {Promise<void>}
     */
    async onInputChange(ctx, inputId, state) {
        if (!state || state.val === null || state.val === undefined) return;

        const enabled = await ctx.getOutputState('enabled');
        if (!enabled || enabled.val !== true) {
            ctx.log.debug(`Input change ignored (disabled): ${inputId}`);
            return;
        }

        switch (inputId) {
            case 'humiditySensor':
                await this._evaluateHumidity(ctx, Number(state.val));
                break;
            case 'presenceSensor':
            case 'doorContact':
                await this._evaluatePresence(ctx);
                break;
            case 'fanStatus':
                await this._updateActiveState(ctx, state.val);
                return; // Status update only, no command logic
        }

        await this._applyDesiredState(ctx);
    }

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {string} outputId
     * @param {any} value
     * @returns {Promise<void>}
     */
    async onOutputWrite(ctx, outputId, value) {
        if (outputId === 'enabled') {
            await ctx.setOutputState('enabled', Boolean(value), true);
            ctx.log.info(`Automatic control ${value ? 'enabled' : 'disabled'} for "${ctx.deviceId}"`);

            if (!value) {
                // Disabled — cancel pending off-timer
                const rt = getRuntime(ctx.deviceId);
                if (rt.offTimer) {
                    clearTimeout(rt.offTimer);
                    rt.offTimer = null;
                }
            } else {
                // Re-enabled — re-evaluate
                const humState = await ctx.getInputState('humiditySensor');
                if (humState?.val !== null && humState?.val !== undefined) {
                    await this._evaluateHumidity(ctx, Number(humState.val));
                }
                await this._evaluatePresence(ctx);
                await this._applyDesiredState(ctx);
            }
        }
    }

    /**
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @returns {Promise<void>}
     */
    async onDestroy(ctx) {
        const rt = runtimeState.get(ctx.deviceId);
        if (rt?.offTimer) {
            clearTimeout(rt.offTimer);
        }
        if (rt?.activeChainExecutor) {
            rt.activeChainExecutor.abort();
        }
        runtimeState.delete(ctx.deviceId);
        ctx.log.info(`Bathroom fan "${ctx.deviceId}" destroyed`);
    }

    // ======================================================================
    // Private logic
    // ======================================================================

    /**
     * Evaluate humidity against threshold/hysteresis and set trigger flag.
     * Does NOT send commands — call _applyDesiredState afterwards.
     *
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {number} humidity
     */
    async _evaluateHumidity(ctx, humidity) {
        const rt = getRuntime(ctx.deviceId);
        const threshold = Number(ctx.config.humidityThreshold ?? 65);
        const hysteresis = Number(ctx.config.humidityHysteresis ?? 5);

        if (humidity > threshold && !rt.humidityTrigger) {
            ctx.log.info(`Humidity ${humidity}% > ${threshold}% — humidity trigger ON`);
            rt.humidityTrigger = true;
        } else if (humidity < (threshold - hysteresis) && rt.humidityTrigger) {
            ctx.log.info(`Humidity ${humidity}% < ${threshold - hysteresis}% — humidity trigger OFF`);
            rt.humidityTrigger = false;
        }
    }

    /**
     * Evaluate presence + door state and set trigger flag.
     * Does NOT send commands — call _applyDesiredState afterwards.
     *
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     */
    async _evaluatePresence(ctx) {
        const rt = getRuntime(ctx.deviceId);

        // Both inputs must be mapped for presence trigger
        if (!ctx.inputs.presenceSensor || !ctx.inputs.doorContact) {
            rt.presenceTrigger = false;
            return;
        }

        const presenceState = await ctx.getInputState('presenceSensor');
        const doorState = await ctx.getInputState('doorContact');

        if (!presenceState || presenceState.val === null || !doorState || doorState.val === null) {
            rt.presenceTrigger = false;
            return;
        }

        const presenceActive = looseEquals(presenceState.val, ctx.config.presenceActiveValue ?? 'true');
        const doorClosed = looseEquals(doorState.val, ctx.config.doorClosedValue ?? 'false');

        const wasActive = rt.presenceTrigger;
        rt.presenceTrigger = presenceActive && doorClosed;

        if (rt.presenceTrigger && !wasActive) {
            ctx.log.info(`Presence + door closed — presence trigger ON`);
        } else if (!rt.presenceTrigger && wasActive) {
            ctx.log.info(`Presence/door condition cleared — presence trigger OFF`);
        }
    }

    /**
     * Determine the desired fan command value based on active triggers and send it.
     * Handles off-delay when all triggers clear.
     *
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     */
    async _applyDesiredState(ctx) {
        const rt = getRuntime(ctx.deviceId);
        const fanOnValue = parseConfigValue(ctx.config.fanOnValue ?? '1');
        const fanOffValue = parseConfigValue(ctx.config.fanOffValue ?? '0');
        const fanSpeedRaw = ctx.config.fanSpeedValue;
        const hasSpeed = fanSpeedRaw !== '' && fanSpeedRaw !== null && fanSpeedRaw !== undefined;
        const fanSpeedValue = hasSpeed ? parseConfigValue(fanSpeedRaw) : null;
        const offDelay = Number(ctx.config.offDelay ?? 120) * 1000;

        // Determine desired value
        let desiredValue = null;
        let triggerName = 'none';

        if (rt.humidityTrigger && rt.presenceTrigger) {
            triggerName = 'both';
            // Humidity gets speed, presence gets on — pick the higher value (numeric) or humidity wins
            const humVal = fanSpeedValue !== null ? fanSpeedValue : fanOnValue;
            if (typeof humVal === 'number' && typeof fanOnValue === 'number') {
                desiredValue = Math.max(humVal, fanOnValue);
            } else {
                desiredValue = humVal; // Non-numeric: humidity trigger takes priority
            }
        } else if (rt.humidityTrigger) {
            triggerName = 'humidity';
            desiredValue = fanSpeedValue !== null ? fanSpeedValue : fanOnValue;
        } else if (rt.presenceTrigger) {
            triggerName = 'presence';
            desiredValue = fanOnValue;
        }

        await ctx.setOutputState('trigger', triggerName, true);

        if (desiredValue !== null) {
            // Cancel any pending off-timer
            if (rt.offTimer) {
                clearTimeout(rt.offTimer);
                rt.offTimer = null;
            }

            await this._sendFanCommand(ctx, desiredValue);
        } else {
            // All triggers off — start off-delay (or turn off immediately if delay=0)
            if (rt.lastCommandValue !== null && !looseEquals(rt.lastCommandValue, fanOffValue)) {
                if (rt.offTimer) return; // Already waiting

                if (offDelay <= 0) {
                    await this._sendFanCommand(ctx, fanOffValue);
                } else {
                    ctx.log.info(`All triggers cleared — off-delay ${offDelay / 1000}s started`);
                    rt.offTimer = setTimeout(async () => {
                        rt.offTimer = null;
                        // Re-check triggers (they may have re-activated during delay)
                        if (!rt.humidityTrigger && !rt.presenceTrigger) {
                            ctx.log.info(`Off-delay elapsed — turning fan OFF`);
                            await this._sendFanCommand(ctx, fanOffValue);
                            await ctx.setOutputState('trigger', 'none', true);
                        }
                    }, offDelay);
                }
            }
        }
    }

    /**
     * Build and execute an action chain to set the fan to the desired value.
     *
     * Uses `ctx.executeChain()` when available (plugin-interface level).
     * Falls back to direct `setForeignStateAsync` for backward compatibility.
     *
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {any} value - The target command value.
     */
    async _sendFanCommand(ctx, value) {
        const rt = getRuntime(ctx.deviceId);

        if (rt.lastCommandValue === value) return; // No change needed

        // Abort any running chain before starting a new one
        if (rt.activeChainExecutor) {
            rt.activeChainExecutor.abort();
            rt.activeChainExecutor = null;
        }

        rt.lastCommandValue = value;

        const chain = this._buildChain(ctx, value);

        if (chain.length > 0 && typeof ctx.executeChain === 'function') {
            try {
                rt.activeChainExecutor = await ctx.executeChain(chain);
            } catch (e) {
                if (e.message && e.message.includes('aborted')) {
                    ctx.log.debug('Fan command chain was aborted');
                    return;
                }
                ctx.log.error(`Fan command chain failed: ${e}`);
            } finally {
                rt.activeChainExecutor = null;
            }
        } else if (ctx.inputs.fanCommand) {
            // Fallback: direct write (no chain support or single-step)
            await ctx.adapter.setForeignStateAsync(ctx.inputs.fanCommand, value, false);
        }

        const isOn = !looseEquals(value, ctx.config.fanOffValue ?? '0');
        await ctx.setOutputState('active', isOn, true);

        ctx.log.info(`Fan command: ${value} (active=${isOn})`);
    }

    /**
     * Build an action chain for the given target value.
     *
     * If user-configured chains exist (ctx.chains.on / ctx.chains.off),
     * use those. Otherwise fall back to single-step fanCommand.
     *
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {any} value
     * @returns {import('../lib/plugin-interface').ActionChain}
     */
    _buildChain(ctx, value) {
        const fanOffValue = parseConfigValue(ctx.config.fanOffValue ?? '0');
        const isOn = !looseEquals(value, fanOffValue);
        const slotId = isOn ? 'on' : 'off';

        // Use user-configured chain if available
        if (ctx.chains && ctx.chains[slotId] && ctx.chains[slotId].length > 0) {
            return ctx.chains[slotId];
        }

        // Fallback: single-step chain using fanCommand input
        /** @type {import('../lib/plugin-interface').ActionChain} */
        const chain = [];

        if (!ctx.inputs.fanCommand) return chain;

        chain.push({
            objectId: ctx.inputs.fanCommand,
            value,
        });

        return chain;
    }

    /**
     * Update active output state based on fanStatus reading.
     *
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {any} statusVal
     */
    async _updateActiveState(ctx, statusVal) {
        const isOn = !looseEquals(statusVal, ctx.config.statusOffValue ?? '0');
        await ctx.setOutputState('active', isOn, true);
    }
}

module.exports = { BathroomFanPlugin };

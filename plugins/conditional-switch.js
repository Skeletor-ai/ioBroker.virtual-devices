'use strict';

/**
 * Conditional Switch plugin.
 *
 * Generic rule-based switch controller. Evaluates up to 4 conditions on
 * arbitrary datapoints. All conditions must be met (AND) to activate the
 * output switches. An optional modifier input can change condition thresholds
 * dynamically (e.g., higher temperature when TV is running).
 *
 * @module conditional-switch
 */

// ---------------------------------------------------------------------------
// Condition evaluation helpers
// ---------------------------------------------------------------------------

/**
 * Parse a config value to match the type of the actual state value.
 * @param {any} stateVal - actual state value
 * @param {string} configVal - value from config (string)
 * @returns {any}
 */
function parseValue(stateVal, configVal) {
    if (typeof stateVal === 'boolean') {
        return configVal === 'true' || configVal === '1' || configVal === 'on';
    }
    if (typeof stateVal === 'number') {
        return Number(configVal);
    }
    return String(configVal);
}

/**
 * Evaluate a single condition.
 * @param {any} actual - current state value
 * @param {string} operator - comparison operator
 * @param {any} target - target value (already parsed)
 * @returns {boolean}
 */
function evaluate(actual, operator, target) {
    switch (operator) {
        case '>':  return actual > target;
        case '<':  return actual < target;
        case '>=': return actual >= target;
        case '<=': return actual <= target;
        case '==': return actual == target; // intentional loose comparison
        case '!=': return actual != target; // intentional loose comparison
        default:   return false;
    }
}

// ---------------------------------------------------------------------------
// Operator options for config selects
// ---------------------------------------------------------------------------

const OPERATOR_OPTIONS = [
    { label: '> (greater than)',    value: '>' },
    { label: '< (less than)',       value: '<' },
    { label: '>= (greater/equal)',  value: '>=' },
    { label: '<= (less/equal)',     value: '<=' },
    { label: '== (equals)',         value: '==' },
    { label: '!= (not equals)',     value: '!=' },
];

const BOOL_OPTIONS = [
    { label: '—',    value: '' },
    { label: 'true',  value: 'true' },
    { label: 'false', value: 'false' },
];

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

class ConditionalSwitchPlugin {
    constructor() {
        /** @type {string} */
        this.id = 'conditional-switch';

        /** @type {Record<string,string>} */
        this.name = {
            en: 'Conditional Switch',
            de: 'Bedingter Schalter',
        };

        /** @type {Record<string,string>} */
        this.description = {
            en: 'Rule-based switch with configurable conditions and optional modifier',
            de: 'Regelbasierter Schalter mit konfigurierbaren Bedingungen und optionalem Modifier',
        };

        // -- Input slots -------------------------------------------------------

        this.inputSlots = [
            {
                id: 'switch1',
                name: { en: 'Switch 1 (primary)', de: 'Schalter 1 (primär)' },
                description: { en: 'Primary output switch', de: 'Primärer Ausgangsschalter' },
                required: true,
                filter: { type: 'state', common: { type: 'boolean' } },
            },
            {
                id: 'switch2',
                name: { en: 'Switch 2 (secondary)', de: 'Schalter 2 (sekundär)' },
                description: { en: 'Optional secondary switch', de: 'Optionaler zweiter Schalter' },
                required: false,
                filter: { type: 'state', common: { type: 'boolean' } },
            },
            {
                id: 'condition1',
                name: { en: 'Condition 1 input', de: 'Bedingung 1 Eingang' },
                description: { en: 'Datapoint for condition 1', de: 'Datenpunkt für Bedingung 1' },
                required: false,
                filter: { type: 'state' },
            },
            {
                id: 'condition2',
                name: { en: 'Condition 2 input', de: 'Bedingung 2 Eingang' },
                description: { en: 'Datapoint for condition 2', de: 'Datenpunkt für Bedingung 2' },
                required: false,
                filter: { type: 'state' },
            },
            {
                id: 'condition3',
                name: { en: 'Condition 3 input', de: 'Bedingung 3 Eingang' },
                description: { en: 'Datapoint for condition 3', de: 'Datenpunkt für Bedingung 3' },
                required: false,
                filter: { type: 'state' },
            },
            {
                id: 'condition4',
                name: { en: 'Condition 4 input', de: 'Bedingung 4 Eingang' },
                description: { en: 'Datapoint for condition 4', de: 'Datenpunkt für Bedingung 4' },
                required: false,
                filter: { type: 'state' },
            },
            {
                id: 'modifier',
                name: { en: 'Modifier input', de: 'Modifier Eingang' },
                description: {
                    en: 'When active, conditions use their alternative values',
                    de: 'Wenn aktiv, nutzen Bedingungen ihre Alternativwerte',
                },
                required: false,
                filter: { type: 'state' },
            },
        ];

        // -- Config schema -----------------------------------------------------

        this.configSchema = {
            // -- Condition 1 --
            condition1_operator: {
                type: 'select', label: { en: 'Condition 1 operator', de: 'Bedingung 1 Operator' },
                options: OPERATOR_OPTIONS, sm: 4, newLine: true,
            },
            condition1_value: {
                type: 'text', label: { en: 'Condition 1 value', de: 'Bedingung 1 Wert' },
                sm: 4,
            },
            condition1_altValue: {
                type: 'text', label: { en: 'Alt. value (modifier)', de: 'Alt. Wert (Modifier)' },
                help: { en: 'Used when modifier is active. Leave empty to keep normal value.', de: 'Wird verwendet wenn Modifier aktiv. Leer = Normalwert.' },
                sm: 4,
            },

            // -- Condition 2 --
            condition2_operator: {
                type: 'select', label: { en: 'Condition 2 operator', de: 'Bedingung 2 Operator' },
                options: OPERATOR_OPTIONS, sm: 4, newLine: true,
            },
            condition2_value: {
                type: 'text', label: { en: 'Condition 2 value', de: 'Bedingung 2 Wert' },
                sm: 4,
            },
            condition2_altValue: {
                type: 'text', label: { en: 'Alt. value (modifier)', de: 'Alt. Wert (Modifier)' },
                sm: 4,
            },

            // -- Condition 3 --
            condition3_operator: {
                type: 'select', label: { en: 'Condition 3 operator', de: 'Bedingung 3 Operator' },
                options: OPERATOR_OPTIONS, sm: 4, newLine: true,
            },
            condition3_value: {
                type: 'text', label: { en: 'Condition 3 value', de: 'Bedingung 3 Wert' },
                sm: 4,
            },
            condition3_altValue: {
                type: 'text', label: { en: 'Alt. value (modifier)', de: 'Alt. Wert (Modifier)' },
                sm: 4,
            },

            // -- Condition 4 --
            condition4_operator: {
                type: 'select', label: { en: 'Condition 4 operator', de: 'Bedingung 4 Operator' },
                options: OPERATOR_OPTIONS, sm: 4, newLine: true,
            },
            condition4_value: {
                type: 'text', label: { en: 'Condition 4 value', de: 'Bedingung 4 Wert' },
                sm: 4,
            },
            condition4_altValue: {
                type: 'text', label: { en: 'Alt. value (modifier)', de: 'Alt. Wert (Modifier)' },
                sm: 4,
            },

            // -- Modifier --
            modifier_operator: {
                type: 'select', label: { en: 'Modifier operator', de: 'Modifier Operator' },
                options: OPERATOR_OPTIONS, sm: 6, newLine: true,
            },
            modifier_value: {
                type: 'text', label: { en: 'Modifier trigger value', de: 'Modifier Auslösewert' },
                help: { en: 'When modifier input matches → alternative values are used', de: 'Wenn Modifier-Eingang zutrifft → Alternativwerte werden benutzt' },
                sm: 6,
            },

            // -- Hysteresis --
            hysteresis: {
                type: 'number',
                label: { en: 'Hysteresis (for number conditions)', de: 'Hysterese (für Zahlenbedingungen)' },
                help: { en: 'Prevents rapid on/off cycling for numeric thresholds', de: 'Verhindert schnelles Ein-/Ausschalten bei Zahlenschwellen' },
                min: 0, max: 20,
            },
        };

        this.configDefaults = {
            condition1_operator: '>', condition1_value: '', condition1_altValue: '',
            condition2_operator: '==', condition2_value: '', condition2_altValue: '',
            condition3_operator: '==', condition3_value: '', condition3_altValue: '',
            condition4_operator: '==', condition4_value: '', condition4_altValue: '',
            modifier_operator: '==', modifier_value: '',
            hysteresis: 0,
        };

        // -- Output states -----------------------------------------------------

        this.outputStates = [
            {
                id: 'active',
                name: { en: 'Active', de: 'Aktiv' },
                description: { en: 'All conditions met, switches are on', de: 'Alle Bedingungen erfüllt, Schalter sind ein' },
                type: 'boolean',
                role: 'indicator.working',
                read: true, write: false,
            },
            {
                id: 'modifierActive',
                name: { en: 'Modifier active', de: 'Modifier aktiv' },
                type: 'boolean',
                role: 'indicator',
                read: true, write: false,
            },
            {
                id: 'enabled',
                name: { en: 'Automatic control', de: 'Automatische Steuerung' },
                description: { en: 'Enable/disable automatic switch control', de: 'Automatische Schaltersteuerung ein-/ausschalten' },
                type: 'boolean',
                role: 'switch.enable',
                read: true, write: true,
            },
        ];
    }

    // ======================================================================
    // Lifecycle
    // ======================================================================

    async onInit(ctx) {
        await ctx.setOutputState('active', false, true);
        await ctx.setOutputState('modifierActive', false, true);

        const enabledState = await ctx.getOutputState('enabled');
        if (enabledState === null || enabledState.val === null) {
            await ctx.setOutputState('enabled', true, true);
        }

        // Do an initial evaluation
        await this._evaluate(ctx);

        ctx.log.info(`Conditional switch "${ctx.deviceId}" initialised`);
    }

    async onInputChange(ctx, inputId, state) {
        if (!state) return;
        await this._evaluate(ctx);
    }

    async onDestroy(ctx) {
        ctx.log.info(`Conditional switch "${ctx.deviceId}" destroyed`);
    }

    // ======================================================================
    // Core evaluation
    // ======================================================================

    /**
     * Evaluate all conditions and set switches accordingly.
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     */
    async _evaluate(ctx) {
        const enabled = await ctx.getOutputState('enabled');
        if (!enabled || enabled.val !== true) {
            // Disabled → turn off
            await this._setSwitches(ctx, false);
            return;
        }

        // 1. Check modifier state
        let modifierActive = false;
        if (ctx.inputs.modifier) {
            const modState = await ctx.getInputState('modifier');
            if (modState?.val !== null && modState?.val !== undefined) {
                const modOp = ctx.config.modifier_operator || '==';
                const modTarget = parseValue(modState.val, ctx.config.modifier_value || '');
                modifierActive = evaluate(modState.val, modOp, modTarget);
            }
        }
        await ctx.setOutputState('modifierActive', modifierActive, true);

        // 2. Evaluate each condition
        const conditionIds = ['condition1', 'condition2', 'condition3', 'condition4'];
        let allMet = true;
        let anyConfigured = false;

        for (const condId of conditionIds) {
            if (!ctx.inputs[condId]) continue;

            const op = ctx.config[`${condId}_operator`];
            const valStr = ctx.config[`${condId}_value`];
            if (!op || valStr === '' || valStr === undefined) continue;

            anyConfigured = true;
            const state = await ctx.getInputState(condId);
            if (state?.val === null || state?.val === undefined) {
                allMet = false;
                continue;
            }

            // Use alternative value if modifier is active and altValue is set
            const altValStr = ctx.config[`${condId}_altValue`];
            const useAlt = modifierActive && altValStr !== '' && altValStr !== undefined;
            const targetStr = useAlt ? altValStr : valStr;
            const target = parseValue(state.val, targetStr);

            const met = evaluate(state.val, op, target);
            if (!met) {
                allMet = false;
            }
        }

        // No conditions configured → don't activate
        if (!anyConfigured) {
            await this._setSwitches(ctx, false);
            await ctx.setOutputState('active', false, true);
            return;
        }

        const currentActive = await ctx.getOutputState('active');
        const wasActive = currentActive?.val === true;

        if (allMet && !wasActive) {
            ctx.log.info(`All conditions met → turning ON`);
            await this._setSwitches(ctx, true);
            await ctx.setOutputState('active', true, true);
        } else if (!allMet && wasActive) {
            ctx.log.info(`Condition(s) no longer met → turning OFF`);
            await this._setSwitches(ctx, false);
            await ctx.setOutputState('active', false, true);
        }
    }

    /**
     * Set the physical output switches.
     * @param {import('../lib/plugin-interface').PluginContext} ctx
     * @param {boolean} on
     */
    async _setSwitches(ctx, on) {
        if (ctx.inputs.switch1) {
            await ctx.adapter.setForeignStateAsync(ctx.inputs.switch1, on, false);
        }
        if (ctx.inputs.switch2) {
            await ctx.adapter.setForeignStateAsync(ctx.inputs.switch2, on, false);
        }
    }
}

module.exports = { ConditionalSwitchPlugin };

'use strict';

/**
 * Plugin interface definitions for virtual-devices adapter.
 *
 * Each virtual device type is defined as a plugin that implements the
 * VirtualDevicePlugin interface. Plugins declare their input slots,
 * configuration schema, output states, and logic callbacks.
 *
 * In JavaScript these interfaces exist only as JSDoc typedefs for IDE
 * autocomplete — the runtime helpers below provide factory/validation support.
 *
 * @module plugin-interface
 */

// ---------------------------------------------------------------------------
// JSDoc type definitions (no runtime cost, IDE support only)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} InputSlot
 * @property {string}                          id          - Unique id within the plugin (e.g., 'humiditySensor').
 * @property {string|Record<string,string>}    name        - Human-readable name (i18n).
 * @property {string|Record<string,string>}    [description] - Optional longer description (i18n).
 * @property {boolean}                         required    - Whether this input must be mapped.
 * @property {Object}                          filter      - Object filter for the admin objectId picker.
 * @property {'state'|'channel'|'device'}      [filter.type] - Limit to a specific object type.
 * @property {Object}                          [filter.common]
 * @property {string|string[]}                 [filter.common.type]  - Accepted common.type values.
 * @property {string|string[]}                 [filter.common.role]  - Accepted common.role values.
 * @property {string|string[]}                 [filter.common.unit]  - Accepted common.unit values.
 */

/**
 * @typedef {Object} OutputStateDefinition
 * @property {string}                          id     - State id suffix (appended to the device path).
 * @property {string|Record<string,string>}    name   - Human-readable name (i18n).
 * @property {string}                          type   - ioBroker common.type ('boolean', 'number', 'string', …).
 * @property {string}                          role   - ioBroker common.role.
 * @property {string}                          [unit] - Optional unit string (e.g., '%', 'W').
 * @property {boolean}                         read   - Whether the state is readable.
 * @property {boolean}                         write  - Whether the state is writable.
 * @property {number}                          [min]  - Optional minimum value.
 * @property {number}                          [max]  - Optional maximum value.
 */

/**
 * @typedef {Object} WaitCondition
 * @property {'delay'|'state'}  type      - Wait type: 'delay' for timed wait, 'state' for state-based wait.
 * @property {number}           [ms]      - Milliseconds to wait (type=delay).
 * @property {string}           [objectId] - Object ID to watch (type=state). Defaults to previous step's objectId.
 * @property {any}              [value]   - Expected value to wait for (type=state).
 * @property {number}           [timeout] - Max wait time in ms for state watch (default 30000).
 */

/**
 * @typedef {Object} ActionChainStep
 * @property {string}          objectId      - ioBroker object ID to write to.
 * @property {any}             value         - Value to write.
 * @property {WaitCondition}   [waitBefore]  - Wait condition BEFORE setting this step's value.
 */

/** @typedef {ActionChainStep[]} ActionChain */

/**
 * @typedef {Object} PluginContext
 * @property {string}                          deviceId       - Unique device id.
 * @property {Record<string,any>}              config         - Resolved configuration values (merged with defaults).
 * @property {Record<string,string>}           inputs         - Mapping of inputSlot id → ioBroker object id.
 * @property {Record<string,ActionChainStep[]>} chains        - Stored action chain configs keyed by slot id.
 * @property {function(string): Promise<ioBroker.State|null>}   getInputState  - Read the current value of a mapped input state.
 * @property {function(string, any, boolean=): Promise<void>}   setOutputState - Write a value to one of the device's output states.
 * @property {function(string): Promise<ioBroker.State|null>}   getOutputState - Read the current value of one of the device's output states.
 * @property {function(ActionChain): Promise<import('./action-chain').ActionChainExecutor>} executeChain - Execute an action chain (returns executor for abort).
 * @property {ioBroker.Logger}                 log            - Logger scoped to this device.
 * @property {ioBroker.Adapter}                adapter        - Direct adapter reference for advanced use-cases.
 */

/**
 * @typedef {Object} JsonConfigItem
 * @property {string} type - JSONConfig item type.
 */

/**
 * @typedef {Object} ActionChainSlot
 * @property {string|Record<string,string>}    name        - Human-readable name (i18n), e.g. "ON Chain".
 * @property {string|Record<string,string>}    [description] - Optional description (i18n).
 */

/**
 * @typedef {Object} VirtualDevicePlugin
 * @property {string}                          id             - Unique plugin identifier (kebab-case).
 * @property {string|Record<string,string>}    name           - Human-readable plugin name (i18n).
 * @property {string|Record<string,string>}    description    - Short description (i18n).
 * @property {string}                          [icon]         - Optional icon (base64 data-URL or HTTP URL).
 * @property {InputSlot[]}                     inputSlots     - Inputs the plugin expects.
 * @property {Record<string,JsonConfigItem>}   configSchema   - JSONConfig schema fragment for settings.
 * @property {Record<string,any>}              configDefaults - Default values for each config property.
 * @property {OutputStateDefinition[]}         outputStates   - States the virtual device exposes.
 * @property {Record<string,ActionChainSlot>}  [actionChainSlots] - Configurable action chain slots (e.g. {on: ..., off: ...}).
 * @property {function(PluginContext): Promise<void>}                         onInit        - Called once on start.
 * @property {function(PluginContext, string, ioBroker.State|null): Promise<void>} onInputChange - Called on input state change.
 * @property {function(PluginContext): Promise<void>}                         [onInterval]  - Optional periodic callback.
 * @property {function(PluginContext): Promise<void>}                         onDestroy     - Called on stop.
 */

/**
 * @typedef {Object} StoredDeviceConfig
 * @property {string}               pluginId   - Plugin id that owns this device.
 * @property {string}               deviceName - Human-readable device name.
 * @property {Record<string,string>} inputs    - Mapping of input slot id → object id.
 * @property {Record<string,any>}   config     - Plugin-specific configuration values.
 * @property {Record<string,ActionChainStep[]>} [chains] - Action chain configurations keyed by slot id.
 */

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a plugin object has all required properties.
 *
 * @param {VirtualDevicePlugin} plugin
 * @returns {boolean}
 */
function validatePlugin(plugin) {
    if (!plugin || typeof plugin !== 'object') return false;
    const requiredStrings = ['id'];
    for (const key of requiredStrings) {
        if (typeof plugin[key] !== 'string' || !plugin[key]) return false;
    }
    const requiredArrays = ['inputSlots', 'outputStates'];
    for (const key of requiredArrays) {
        if (!Array.isArray(plugin[key])) return false;
    }
    const requiredFunctions = ['onInit', 'onInputChange', 'onDestroy'];
    for (const key of requiredFunctions) {
        if (typeof plugin[key] !== 'function') return false;
    }
    return true;
}

module.exports = {
    validatePlugin,
};

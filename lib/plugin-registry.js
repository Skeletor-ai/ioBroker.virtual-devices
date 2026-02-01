'use strict';

/**
 * Central registry for virtual device plugins.
 *
 * All built-in (and future external) plugins are registered here so the
 * adapter core and the device-management layer can discover them.
 *
 * @module plugin-registry
 */

/** @type {Map<string, import('./plugin-interface').VirtualDevicePlugin>} */
const plugins = new Map();

/**
 * Register a plugin.  Throws if a plugin with the same id is already
 * registered.
 *
 * @param {import('./plugin-interface').VirtualDevicePlugin} plugin
 */
function registerPlugin(plugin) {
    if (plugins.has(plugin.id)) {
        throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    plugins.set(plugin.id, plugin);
}

/**
 * Retrieve a plugin by id, or `undefined` if not found.
 *
 * @param {string} id
 * @returns {import('./plugin-interface').VirtualDevicePlugin | undefined}
 */
function getPlugin(id) {
    return plugins.get(id);
}

/**
 * Return all registered plugins as an array.
 *
 * @returns {import('./plugin-interface').VirtualDevicePlugin[]}
 */
function getAllPlugins() {
    return Array.from(plugins.values());
}

/**
 * Load all built-in plugins shipped with the adapter.
 *
 * @returns {Promise<void>}
 */
async function loadBuiltInPlugins() {
    // Dynamic require keeps the registry independent of concrete plugins.
    const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
    registerPlugin(new SmartDehumidifierPlugin());
}

module.exports = {
    registerPlugin,
    getPlugin,
    getAllPlugins,
    loadBuiltInPlugins,
};

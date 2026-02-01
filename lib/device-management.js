'use strict';

/**
 * Device management integration via `@iobroker/dm-utils`.
 *
 * This module extends the dm-utils `DeviceManagement` base class and wires
 * every admin UI interaction (add / edit / delete / details / controls)
 * through to the plugin system.  No custom React — everything is driven by
 * JSONConfig forms and the standard device-manager UI in ioBroker admin.
 *
 * @module device-management
 */

const { DeviceManagement } = require('@iobroker/dm-utils');
const { getAllPlugins, getPlugin } = require('./plugin-registry');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve an i18n StringOrTranslated to a plain string (English fallback).
 *
 * @param {string | Record<string,string>} s
 * @returns {string}
 */
function t(s) {
    if (typeof s === 'string') return s;
    return s.en ?? Object.values(s)[0] ?? '';
}

/**
 * Build a JSONConfig `objectID` item from an InputSlot definition.
 * The resulting picker will pre-filter objects based on the slot's filter.
 *
 * @param {import('./plugin-interface').InputSlot} slot
 * @returns {import('./plugin-interface').JsonConfigItem}
 */
function buildObjectIdPicker(slot) {
    const item = {
        type: 'objectId',
        label: slot.name,
        help: slot.description,
    };

    // Build customFilter for the objectId picker
    /** @type {Record<string, any>} */
    const customFilter = {};

    if (slot.filter.type) {
        customFilter.type = slot.filter.type;
    }

    if (slot.filter.common) {
        /** @type {Record<string, any>} */
        const common = {};
        if (slot.filter.common.type) {
            common.type = slot.filter.common.type;
        }
        if (slot.filter.common.role) {
            const roles = Array.isArray(slot.filter.common.role)
                ? slot.filter.common.role
                : [slot.filter.common.role];
            common.role = roles.join('|');
        }
        if (slot.filter.common.unit) {
            common.unit = slot.filter.common.unit;
        }
        customFilter.common = common;
    }

    item.customFilter = customFilter;
    return item;
}

/**
 * Merge a plugin's input-slot pickers and config schema into a single
 * JSONConfig schema suitable for `context.showForm()`.
 *
 * @param {import('./plugin-interface').VirtualDevicePlugin} plugin
 * @param {Record<string, any>} [existingValues]
 * @returns {{ schema: object, data: Record<string, any> }}
 */
function buildDeviceForm(plugin, existingValues) {
    /** @type {Record<string, any>} */
    const items = {};
    /** @type {Record<string, any>} */
    const data = existingValues ? { ...existingValues } : {};

    // -- Header: Input Datapoints -------------------------------------------
    items._inputHeader = {
        type: 'header',
        text: { en: 'Input Datapoints', de: 'Eingangs-Datenpunkte' },
        size: 4,
    };

    for (const slot of plugin.inputSlots) {
        const key = `input_${slot.id}`;
        items[key] = buildObjectIdPicker(slot);
        if (!data[key]) {
            data[key] = '';
        }
    }

    // -- Header: Device Settings --------------------------------------------
    if (Object.keys(plugin.configSchema).length > 0) {
        items._configHeader = {
            type: 'header',
            text: { en: 'Device Settings', de: 'Geräteeinstellungen' },
            size: 4,
        };

        for (const [key, schema] of Object.entries(plugin.configSchema)) {
            const cfgKey = `cfg_${key}`;
            items[cfgKey] = { ...schema };
            if (data[cfgKey] === undefined) {
                data[cfgKey] = plugin.configDefaults[key];
            }
        }
    }

    const formSchema = {
        type: 'panel',
        items,
    };

    return { schema: formSchema, data };
}

/**
 * Extract input mappings and config values from the flat form data returned
 * by `context.showForm()`.
 *
 * @param {import('./plugin-interface').VirtualDevicePlugin} plugin
 * @param {Record<string, any>} formData
 * @returns {{ inputs: Record<string, string>, config: Record<string, any> }}
 */
function parseFormData(plugin, formData) {
    /** @type {Record<string, string>} */
    const inputs = {};
    /** @type {Record<string, any>} */
    const config = {};

    for (const slot of plugin.inputSlots) {
        const v = formData[`input_${slot.id}`];
        if (v) {
            inputs[slot.id] = String(v);
        }
    }

    for (const key of Object.keys(plugin.configSchema)) {
        const v = formData[`cfg_${key}`];
        config[key] = v !== undefined ? v : plugin.configDefaults[key];
    }

    return { inputs, config };
}

// ---------------------------------------------------------------------------
// DeviceManagement implementation
// ---------------------------------------------------------------------------

class VirtualDevicesManagement extends DeviceManagement {

    // -- Instance info & actions -------------------------------------------

    /** @returns {object} */
    async getInstanceInfo() {
        return {
            ...super.getInstanceInfo(),
            apiVersion: 'v1',
            actions: [
                {
                    id: 'add-device',
                    icon: 'add',
                    title: { en: 'Add virtual device', de: 'Virtuelles Gerät hinzufügen' },
                    description: { en: 'Add virtual device', de: 'Virtuelles Gerät hinzufügen' },
                    handler: (context) => this.addDevice(context),
                },
            ],
        };
    }

    // -- List devices ------------------------------------------------------

    /** @returns {Promise<object[]>} */
    async listDevices() {
        /** @type {object[]} */
        const devices = [];

        const objs = await this.adapter.getObjectViewAsync('system', 'channel', {
            startkey: `${this.adapter.namespace}.devices.`,
            endkey: `${this.adapter.namespace}.devices.\u9999`,
        });

        if (!objs?.rows) return devices;

        for (const row of objs.rows) {
            const obj = row.value;
            if (!obj) continue;

            /** @type {import('./plugin-interface').StoredDeviceConfig | undefined} */
            const native = obj.native;
            if (!native?.pluginId) continue;

            const plugin = getPlugin(native.pluginId);
            const deviceId = row.id.split('.').pop();

            // Determine status: all required inputs mapped?
            let allMapped = true;
            if (plugin) {
                for (const slot of plugin.inputSlots) {
                    if (slot.required && !native.inputs?.[slot.id]) {
                        allMapped = false;
                        break;
                    }
                }
            }

            // Build controls from writable output states
            /** @type {object[]} */
            const controls = [];
            if (plugin) {
                for (const out of plugin.outputStates) {
                    if (out.write && out.type === 'boolean') {
                        const stateId = `${this.adapter.namespace}.${deviceId}.${out.id}`;
                        controls.push({
                            id: out.id,
                            type: 'switch',
                            stateId,
                            label: out.name,
                        });
                    }
                }
            }

            devices.push({
                id: deviceId,
                name: native.deviceName || deviceId,
                status: allMapped ? 'connected' : 'disconnected',
                hasDetails: true,
                actions: [
                    {
                        id: 'edit',
                        icon: 'edit',
                        description: { en: 'Edit device', de: 'Gerät bearbeiten' },
                        handler: (devId, context) =>
                            this.editDevice(devId, context),
                    },
                    {
                        id: 'delete',
                        icon: 'delete',
                        description: { en: 'Delete device', de: 'Gerät löschen' },
                        handler: (devId, context) =>
                            this.deleteDevice(devId, context),
                    },
                ],
                controls,
            });
        }

        return devices;
    }

    // -- Device details (read-only current values) -------------------------

    /**
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async getDeviceDetails(id) {
        const objId = `${this.adapter.namespace}.devices.${id}`;
        const obj = await this.adapter.getObjectAsync(objId);
        if (!obj) return null;

        /** @type {import('./plugin-interface').StoredDeviceConfig} */
        const native = obj.native;
        const plugin = getPlugin(native.pluginId);
        if (!plugin) return null;

        /** @type {Record<string, any>} */
        const items = {
            _header: {
                type: 'header',
                text: { en: 'Current Values', de: 'Aktuelle Werte' },
                size: 4,
            },
        };

        /** @type {Record<string, any>} */
        const data = {};

        for (const out of plugin.outputStates) {
            const stateId = `${this.adapter.namespace}.${id}.${out.id}`;
            const state = await this.adapter.getStateAsync(stateId);

            let displayValue = state?.val ?? '—';
            if (out.unit && state?.val !== null && state?.val !== undefined) {
                displayValue = `${state.val} ${out.unit}`;
            }

            const key = `detail_${out.id}`;
            items[key] = {
                type: 'staticText',
                label: out.name,
                text: String(displayValue),
            };
        }

        return {
            id,
            schema: {
                type: 'panel',
                items,
            },
            data,
        };
    }

    // ======================================================================
    // Action handlers
    // ======================================================================

    /**
     * Two-step wizard: first pick plugin type + name, then configure inputs
     * and plugin-specific settings.
     *
     * @param {object} context - ActionContext from dm-utils
     * @returns {Promise<{ refresh: boolean }>}
     */
    async addDevice(context) {
        // -- Step 1: Select plugin type + device name -----------------------
        const plugins = getAllPlugins();
        if (plugins.length === 0) {
            this.adapter.log.warn('No plugins registered — cannot add device');
            return { refresh: false };
        }

        const typeOptions = plugins.map((p) => ({
            value: p.id,
            label: p.name,
        }));

        const step1Schema = {
            type: 'panel',
            items: {
                _header: {
                    type: 'header',
                    text: { en: 'Select device type', de: 'Gerätetyp auswählen' },
                    size: 4,
                },
                pluginId: {
                    type: 'select',
                    label: { en: 'Device type', de: 'Gerätetyp' },
                    options: typeOptions,
                    noTranslation: false,
                },
                deviceName: {
                    type: 'text',
                    label: { en: 'Device name', de: 'Gerätename' },
                    help: { en: 'Enter a name for this device', de: 'Geben Sie einen Namen für dieses Gerät ein' },
                    maxLength: 64,
                },
            },
        };

        const step1Data = {
            pluginId: plugins[0].id,
            deviceName: '',
        };

        const step1Result = await context.showForm(step1Schema, {
            data: step1Data,
            title: { en: 'Add virtual device', de: 'Virtuelles Gerät hinzufügen' },
        });

        if (!step1Result) return { refresh: false };

        const selectedPluginId = String(step1Result.pluginId || plugins[0].id);
        const deviceName = String(step1Result.deviceName || '').trim();
        if (!deviceName) return { refresh: false };

        const plugin = getPlugin(selectedPluginId);
        if (!plugin) return { refresh: false };

        // -- Step 2: Configure inputs + settings ----------------------------
        const { schema, data } = buildDeviceForm(plugin);

        const step2Result = await context.showForm(schema, {
            data,
            title: { en: 'Configure device', de: 'Gerät konfigurieren' },
        });

        if (!step2Result) return { refresh: false };

        const parsed = parseFormData(plugin, step2Result);

        // Generate a unique device id
        const deviceId = `${selectedPluginId}-${Date.now().toString(36)}`;

        // Persist device config as a channel object
        /** @type {import('./plugin-interface').StoredDeviceConfig} */
        const storedConfig = {
            pluginId: selectedPluginId,
            deviceName,
            inputs: parsed.inputs,
            config: parsed.config,
        };

        await this.adapter.setObjectAsync(`devices.${deviceId}`, {
            type: 'channel',
            common: {
                name: deviceName,
            },
            native: storedConfig,
        });

        // Notify main adapter to initialise the new device
        await this.adapter.sendToAsync(this.adapter.namespace, 'deviceAdded', { deviceId });

        return { refresh: true };
    }

    /**
     * Show the device form pre-filled with current config and save changes.
     *
     * @param {string} deviceId
     * @param {object} context - ActionContext from dm-utils
     * @returns {Promise<{ refresh: boolean }>}
     */
    async editDevice(deviceId, context) {
        const objId = `${this.adapter.namespace}.devices.${deviceId}`;
        const obj = await this.adapter.getObjectAsync(objId);
        if (!obj) return { refresh: false };

        /** @type {import('./plugin-interface').StoredDeviceConfig} */
        const native = obj.native;
        const plugin = getPlugin(native.pluginId);
        if (!plugin) return { refresh: false };

        // Pre-fill form data from stored config
        /** @type {Record<string, any>} */
        const existingData = {};
        for (const slot of plugin.inputSlots) {
            existingData[`input_${slot.id}`] = native.inputs?.[slot.id] || '';
        }
        for (const [key, defaultVal] of Object.entries(plugin.configDefaults)) {
            existingData[`cfg_${key}`] = native.config?.[key] ?? defaultVal;
        }

        const { schema } = buildDeviceForm(plugin, existingData);

        const result = await context.showForm(schema, {
            data: existingData,
            title: { en: 'Edit device', de: 'Gerät bearbeiten' },
        });

        if (!result) return { refresh: false };

        const parsed = parseFormData(plugin, result);

        // Update stored config
        /** @type {import('./plugin-interface').StoredDeviceConfig} */
        const updatedConfig = {
            ...native,
            inputs: parsed.inputs,
            config: parsed.config,
        };

        await this.adapter.extendObjectAsync(`devices.${deviceId}`, {
            native: updatedConfig,
        });

        // Notify main adapter to re-initialise the device
        await this.adapter.sendToAsync(this.adapter.namespace, 'deviceUpdated', { deviceId });

        return { refresh: true };
    }

    /**
     * Confirm deletion, remove the device config object and all output states.
     *
     * @param {string} deviceId
     * @param {object} context - ActionContext from dm-utils
     * @returns {Promise<{ refresh: boolean }>}
     */
    async deleteDevice(deviceId, context) {
        const confirmed = await context.showConfirmation({
            en: 'Are you sure you want to delete this device? All associated states will be removed.',
            de: 'Sind Sie sicher, dass Sie dieses Gerät löschen möchten? Alle zugehörigen Datenpunkte werden entfernt.',
        });

        if (!confirmed) return { refresh: false };

        // Delete all output states
        const states = await this.adapter.getStatesAsync(`${deviceId}.*`);
        for (const stateId of Object.keys(states)) {
            const relativeId = stateId.replace(`${this.adapter.namespace}.`, '');
            try {
                await this.adapter.delObjectAsync(relativeId);
            } catch {
                // ignore errors for already-deleted states
            }
        }

        // Delete the device object itself
        try {
            await this.adapter.delObjectAsync(deviceId);
        } catch {
            // ignore
        }

        // Delete the device config channel
        try {
            await this.adapter.delObjectAsync(`devices.${deviceId}`);
        } catch {
            // ignore
        }

        // Notify main adapter
        await this.adapter.sendToAsync(this.adapter.namespace, 'deviceDeleted', { deviceId });

        return { refresh: true };
    }
}

module.exports = VirtualDevicesManagement;

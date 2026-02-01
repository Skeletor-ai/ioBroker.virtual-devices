'use strict';

const path = require('path');
const { tests } = require('@iobroker/testing');
const assert = require('assert');

// Validate adapter package + custom tests
tests.unit(path.join(__dirname, '..'), {
    defineAdditionalTests() {
        describe('Plugin System', () => {
            it('should load built-in plugins', async () => {
                const { loadBuiltInPlugins, getAllPlugins, getPlugin } = require('../lib/plugin-registry');
                await loadBuiltInPlugins();

                const all = getAllPlugins();
                assert(all.length > 0, 'No plugins loaded');

                const dehum = getPlugin('smart-dehumidifier');
                assert(dehum, 'smart-dehumidifier plugin not found');
                assert.strictEqual(dehum.id, 'smart-dehumidifier');
            });

            it('should validate plugin structure', () => {
                const { validatePlugin } = require('../lib/plugin-interface');
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                assert(validatePlugin(plugin), 'Plugin validation failed');
            });

            it('should have correct input slots', () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                assert.strictEqual(plugin.inputSlots.length, 3, `Expected 3 input slots, got ${plugin.inputSlots.length}`);

                const humidity = plugin.inputSlots.find(s => s.id === 'humiditySensor');
                assert(humidity, 'Missing humiditySensor slot');
                assert(humidity.required, 'humiditySensor should be required');
                assert.strictEqual(humidity.filter.common.type, 'number');

                const power = plugin.inputSlots.find(s => s.id === 'powerSwitch');
                assert(power, 'Missing powerSwitch slot');
                assert(power.required, 'powerSwitch should be required');

                const meter = plugin.inputSlots.find(s => s.id === 'powerMeter');
                assert(meter, 'Missing powerMeter slot');
                assert(!meter.required, 'powerMeter should be optional');
            });

            it('should have correct output states', () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                const expectedOutputs = ['running', 'humidity', 'power', 'tankFull', 'enabled'];
                for (const id of expectedOutputs) {
                    const out = plugin.outputStates.find(o => o.id === id);
                    assert(out, `Missing output state: ${id}`);
                }

                const enabled = plugin.outputStates.find(o => o.id === 'enabled');
                assert(enabled.write, 'enabled should be writable');

                const running = plugin.outputStates.find(o => o.id === 'running');
                assert(!running.write, 'running should NOT be writable');

                const tankFull = plugin.outputStates.find(o => o.id === 'tankFull');
                assert.strictEqual(tankFull.role, 'indicator.alarm');

                const humidityOut = plugin.outputStates.find(o => o.id === 'humidity');
                assert.strictEqual(humidityOut.unit, '%');
                assert.strictEqual(humidityOut.role, 'value.humidity');
            });

            it('should have valid config schema and defaults', () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                const requiredConfigs = ['targetHumidity', 'humidityHysteresis', 'tankFullPowerThreshold', 'tankFullDelay'];
                for (const key of requiredConfigs) {
                    assert(plugin.configSchema[key], `Missing config schema: ${key}`);
                    assert(plugin.configDefaults[key] !== undefined, `Missing config default: ${key}`);
                }

                assert.strictEqual(plugin.configDefaults.targetHumidity, 55);
                assert.strictEqual(plugin.configDefaults.humidityHysteresis, 3);
                assert.strictEqual(plugin.configDefaults.tankFullPowerThreshold, 5);
                assert.strictEqual(plugin.configDefaults.tankFullDelay, 60);
            });

            it('should reject invalid plugins', () => {
                const { validatePlugin } = require('../lib/plugin-interface');

                assert(!validatePlugin(null), 'null should fail');
                assert(!validatePlugin({}), 'empty object should fail');
                assert(!validatePlugin({ id: 'test' }), 'missing arrays should fail');
                assert(!validatePlugin({ id: 'test', inputSlots: [], outputStates: [] }), 'missing functions should fail');
            });
        });

        describe('Dehumidifier Logic (unit mock)', () => {
            it('should turn on when humidity exceeds target + hysteresis', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                const states = {};
                let foreignState = null;

                const ctx = {
                    deviceId: 'test-dehum-1',
                    config: { targetHumidity: 55, humidityHysteresis: 3, tankFullPowerThreshold: 5, tankFullDelay: 60 },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power', powerMeter: 'meter.0.power' },
                    getInputState: async (id) => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: {
                        setForeignStateAsync: async (id, val) => { foreignState = { id, val }; },
                    },
                };

                // Init the plugin
                await plugin.onInit(ctx);

                // Enabled should be true
                assert.strictEqual(states.enabled, true);
                assert.strictEqual(states.running, false);

                // Simulate humidity above target + hysteresis (55 + 3 = 58, so 60 should trigger)
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 60, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });

                assert.strictEqual(states.humidity, 60);
                assert.strictEqual(states.running, true);
                assert(foreignState, 'Should have called setForeignStateAsync');
                assert.strictEqual(foreignState.val, true, 'Should have turned switch ON');

                // Cleanup
                await plugin.onDestroy(ctx);
            });

            it('should turn off when humidity drops below target', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                const states = {};
                let foreignState = null;

                const ctx = {
                    deviceId: 'test-dehum-2',
                    config: { targetHumidity: 55, humidityHysteresis: 3, tankFullPowerThreshold: 5, tankFullDelay: 60 },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power', powerMeter: 'meter.0.power' },
                    getInputState: async () => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: {
                        setForeignStateAsync: async (id, val) => { foreignState = { id, val }; },
                    },
                };

                await plugin.onInit(ctx);

                // Turn on first
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 60, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.running, true);

                // Drop below target
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 54, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.running, false);
                assert.strictEqual(foreignState.val, false, 'Should have turned switch OFF');

                await plugin.onDestroy(ctx);
            });

            it('should not turn on when tank is full', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                const states = {};
                let foreignState = null;

                const ctx = {
                    deviceId: 'test-dehum-3',
                    config: { targetHumidity: 55, humidityHysteresis: 3, tankFullPowerThreshold: 5, tankFullDelay: 60 },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power', powerMeter: 'meter.0.power' },
                    getInputState: async () => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: {
                        setForeignStateAsync: async (id, val) => { foreignState = { id, val }; },
                    },
                };

                await plugin.onInit(ctx);

                // Set tank full
                states.tankFull = true;

                // Try to trigger with high humidity
                foreignState = null;
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 70, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });

                // Should NOT have turned on
                assert.strictEqual(states.running, false, 'Should not turn on when tank is full');

                await plugin.onDestroy(ctx);
            });

            it('should not turn on when disabled', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                const states = {};
                let foreignState = null;

                const ctx = {
                    deviceId: 'test-dehum-4',
                    config: { targetHumidity: 55, humidityHysteresis: 3, tankFullPowerThreshold: 5, tankFullDelay: 60 },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power', powerMeter: 'meter.0.power' },
                    getInputState: async () => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: {
                        setForeignStateAsync: async (id, val) => { foreignState = { id, val }; },
                    },
                };

                await plugin.onInit(ctx);

                // Disable device
                states.enabled = false;

                foreignState = null;
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 70, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });

                assert.strictEqual(states.running, false, 'Should not turn on when disabled');

                await plugin.onDestroy(ctx);
            });

            it('should update power output on power meter change', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                const states = {};

                const ctx = {
                    deviceId: 'test-dehum-5',
                    config: { targetHumidity: 55, humidityHysteresis: 3, tankFullPowerThreshold: 5, tankFullDelay: 60 },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power', powerMeter: 'meter.0.power' },
                    getInputState: async () => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: {
                        setForeignStateAsync: async () => {},
                    },
                };

                await plugin.onInit(ctx);

                await plugin.onInputChange(ctx, 'powerMeter', { val: 150, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.power, 150);

                await plugin.onInputChange(ctx, 'powerMeter', { val: 3.2, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.power, 3.2);

                await plugin.onDestroy(ctx);
            });

            it('should respect hysteresis (not toggle on boundary)', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();

                const states = {};

                const ctx = {
                    deviceId: 'test-dehum-6',
                    config: { targetHumidity: 55, humidityHysteresis: 3, tankFullPowerThreshold: 5, tankFullDelay: 60 },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power' },
                    getInputState: async () => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: { setForeignStateAsync: async () => {} },
                };

                await plugin.onInit(ctx);

                // 57% is above target (55) but NOT above target + hysteresis (58)
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 57, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.running, false, 'Should NOT turn on at 57% (within hysteresis)');

                // 58% is still not above (needs to be > 58, not >=)
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 58, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.running, false, 'Should NOT turn on at exactly 58%');

                // 59% should trigger
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 59, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.running, true, 'Should turn on at 59%');

                await plugin.onDestroy(ctx);
            });

            it('should not turn on outside schedule window', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();
                const states = {};

                // Set schedule to a window that does NOT include current time
                const now = new Date();
                const pastStart = `${String((now.getHours() + 2) % 24).padStart(2, '0')}:00`;
                const pastEnd = `${String((now.getHours() + 4) % 24).padStart(2, '0')}:00`;

                const ctx = {
                    deviceId: 'test-dehum-schedule-1',
                    config: {
                        targetHumidity: 55, humidityHysteresis: 3,
                        tankFullPowerThreshold: 5, tankFullDelay: 60,
                        scheduleStart: pastStart, scheduleEnd: pastEnd,
                    },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power' },
                    getInputState: async () => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: { setForeignStateAsync: async () => {} },
                };

                await plugin.onInit(ctx);
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 80, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.running, false, 'Should NOT turn on outside schedule');
                await plugin.onDestroy(ctx);
            });

            it('should allow operation with empty schedule (24/7)', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();
                const states = {};

                const ctx = {
                    deviceId: 'test-dehum-schedule-2',
                    config: {
                        targetHumidity: 55, humidityHysteresis: 3,
                        tankFullPowerThreshold: 5, tankFullDelay: 60,
                        scheduleStart: '', scheduleEnd: '',
                    },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power' },
                    getInputState: async () => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: { setForeignStateAsync: async () => {} },
                };

                await plugin.onInit(ctx);
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 80, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.running, true, 'Should turn on with empty schedule (24/7)');
                await plugin.onDestroy(ctx);
            });

            it('should not turn on when today is disabled in schedule', async () => {
                const { SmartDehumidifierPlugin } = require('../plugins/smart-dehumidifier');
                const plugin = new SmartDehumidifierPlugin();
                const states = {};

                // Disable all days → should never run
                const ctx = {
                    deviceId: 'test-dehum-schedule-3',
                    config: {
                        targetHumidity: 55, humidityHysteresis: 3,
                        tankFullPowerThreshold: 5, tankFullDelay: 60,
                        scheduleStart: '', scheduleEnd: '',
                        scheduleMon: false, scheduleTue: false, scheduleWed: false,
                        scheduleThu: false, scheduleFri: false, scheduleSat: false, scheduleSun: false,
                    },
                    inputs: { humiditySensor: 'sensor.0.humidity', powerSwitch: 'switch.0.power' },
                    getInputState: async () => null,
                    setOutputState: async (id, val) => { states[id] = val; },
                    getOutputState: async (id) => (states[id] !== undefined ? { val: states[id] } : null),
                    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    adapter: { setForeignStateAsync: async () => {} },
                };

                await plugin.onInit(ctx);
                await plugin.onInputChange(ctx, 'humiditySensor', { val: 80, ack: true, ts: Date.now(), lc: Date.now(), from: 'test', q: 0 });
                assert.strictEqual(states.running, false, 'Should NOT turn on when all days disabled');
                await plugin.onDestroy(ctx);
            });
        });
    },
});

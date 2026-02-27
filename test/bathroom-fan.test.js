'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { BathroomFanPlugin } = require('../plugins/bathroom-fan');

// ---------------------------------------------------------------------------
// Mock PluginContext
// ---------------------------------------------------------------------------

function createMockContext(overrides = {}) {
    const outputStates = {};
    const inputStates = {};
    const writtenForeignStates = [];

    return {
        deviceId: overrides.deviceId || 'test-fan-1',
        config: {
            humidityThreshold: 65,
            humidityHysteresis: 5,
            fanOnValue: 1,
            fanOffValue: 0,
            fanSpeedValue: '',
            statusOnValue: 1,
            statusOffValue: 0,
            presenceActiveValue: 'true',
            doorClosedValue: 'false',
            offDelay: 0, // instant off for easier testing
            ...overrides.config,
        },
        inputs: {
            humiditySensor: 'sensor.humidity',
            fanCommand: 'fan.command',
            fanStatus: 'fan.status',
            presenceSensor: overrides.presenceSensor ?? null,
            doorContact: overrides.doorContact ?? null,
        },
        adapter: {
            setForeignStateAsync: async (id, val, ack) => {
                writtenForeignStates.push({ id, val, ack });
            },
        },
        log: {
            info: () => {},
            debug: () => {},
            warn: () => {},
            error: () => {},
        },
        setOutputState: async (id, val, ack) => {
            outputStates[id] = { val, ack };
        },
        getOutputState: async (id) => {
            return outputStates[id] || null;
        },
        getInputState: async (id) => {
            return inputStates[id] || null;
        },
        // Test helpers
        _outputStates: outputStates,
        _inputStates: inputStates,
        _writtenForeignStates: writtenForeignStates,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BathroomFanPlugin', () => {
    let plugin;

    beforeEach(() => {
        plugin = new BathroomFanPlugin();
    });

    describe('metadata', () => {
        it('has correct id', () => {
            assert.equal(plugin.id, 'bathroom-fan');
        });

        it('has name in en and de', () => {
            assert.ok(plugin.name.en);
            assert.ok(plugin.name.de);
        });

        it('has 5 input slots', () => {
            assert.equal(plugin.inputSlots.length, 5);
        });

        it('has 3 output states', () => {
            assert.equal(plugin.outputStates.length, 3);
        });
    });

    describe('onInit', () => {
        it('initialises output states', async () => {
            const ctx = createMockContext();
            await plugin.onInit(ctx);

            assert.equal(ctx._outputStates.active.val, false);
            assert.equal(ctx._outputStates.trigger.val, 'none');
            assert.equal(ctx._outputStates.enabled.val, true);
        });
    });

    describe('humidity trigger', () => {
        it('turns fan ON when humidity exceeds threshold', async () => {
            const ctx = createMockContext();
            await plugin.onInit(ctx);

            await plugin.onInputChange(ctx, 'humiditySensor', { val: 70 });

            assert.equal(ctx._outputStates.active.val, true);
            assert.equal(ctx._outputStates.trigger.val, 'humidity');
            assert.ok(ctx._writtenForeignStates.some(s => s.id === 'fan.command' && s.val === 1));
        });

        it('turns fan OFF when humidity drops below threshold - hysteresis', async () => {
            const ctx = createMockContext();
            await plugin.onInit(ctx);

            // Turn on
            await plugin.onInputChange(ctx, 'humiditySensor', { val: 70 });
            assert.equal(ctx._outputStates.active.val, true);

            // Drop below threshold - hysteresis (65 - 5 = 60)
            await plugin.onInputChange(ctx, 'humiditySensor', { val: 59 });
            assert.equal(ctx._outputStates.active.val, false);
            assert.equal(ctx._outputStates.trigger.val, 'none');
        });

        it('does NOT turn off in hysteresis band', async () => {
            const ctx = createMockContext();
            await plugin.onInit(ctx);

            await plugin.onInputChange(ctx, 'humiditySensor', { val: 70 });
            assert.equal(ctx._outputStates.active.val, true);

            // 62 is between threshold (65) and threshold-hysteresis (60) — should stay on
            await plugin.onInputChange(ctx, 'humiditySensor', { val: 62 });
            assert.equal(ctx._outputStates.active.val, true);
        });

        it('uses fanSpeedValue for humidity trigger when configured', async () => {
            const ctx = createMockContext({ config: { fanSpeedValue: 3 } });
            await plugin.onInit(ctx);

            await plugin.onInputChange(ctx, 'humiditySensor', { val: 70 });

            assert.ok(ctx._writtenForeignStates.some(s => s.id === 'fan.command' && s.val === 3));
        });
    });

    describe('presence trigger', () => {
        it('turns fan ON when presence active and door closed', async () => {
            const ctx = createMockContext({
                presenceSensor: 'sensor.presence',
                doorContact: 'sensor.door',
            });
            ctx._inputStates.doorContact = { val: false };

            await plugin.onInit(ctx);

            ctx._inputStates.presenceSensor = { val: true };
            await plugin.onInputChange(ctx, 'presenceSensor', { val: true });

            assert.equal(ctx._outputStates.active.val, true);
            assert.equal(ctx._outputStates.trigger.val, 'presence');
        });

        it('does NOT trigger when door is open', async () => {
            const ctx = createMockContext({
                presenceSensor: 'sensor.presence',
                doorContact: 'sensor.door',
            });
            ctx._inputStates.presenceSensor = { val: true };
            ctx._inputStates.doorContact = { val: true }; // open

            await plugin.onInit(ctx);
            await plugin.onInputChange(ctx, 'presenceSensor', { val: true });

            assert.equal(ctx._outputStates.trigger.val, 'none');
        });

        it('does NOT trigger when presence inactive', async () => {
            const ctx = createMockContext({
                presenceSensor: 'sensor.presence',
                doorContact: 'sensor.door',
            });
            ctx._inputStates.presenceSensor = { val: false };
            ctx._inputStates.doorContact = { val: false };

            await plugin.onInit(ctx);
            await plugin.onInputChange(ctx, 'presenceSensor', { val: false });

            assert.equal(ctx._outputStates.trigger.val, 'none');
        });

        it('ignores presence when inputs not mapped', async () => {
            const ctx = createMockContext(); // no presenceSensor/doorContact
            await plugin.onInit(ctx);

            // Should not crash or trigger
            await plugin.onInputChange(ctx, 'humiditySensor', { val: 50 });
            assert.equal(ctx._outputStates.trigger.val, 'none');
        });
    });

    describe('both triggers', () => {
        it('reports trigger=both when humidity and presence active', async () => {
            const ctx = createMockContext({
                presenceSensor: 'sensor.presence',
                doorContact: 'sensor.door',
                config: { fanSpeedValue: 3 },
            });
            ctx._inputStates.doorContact = { val: false };

            await plugin.onInit(ctx);

            // Humidity trigger
            ctx._inputStates.humiditySensor = { val: 70 };
            await plugin.onInputChange(ctx, 'humiditySensor', { val: 70 });
            // Presence trigger
            ctx._inputStates.presenceSensor = { val: true };
            await plugin.onInputChange(ctx, 'presenceSensor', { val: true });

            assert.equal(ctx._outputStates.trigger.val, 'both');
            // Should use the higher value (fanSpeedValue=3 > fanOnValue=1)
            assert.ok(ctx._writtenForeignStates.some(s => s.id === 'fan.command' && s.val === 3));
        });
    });

    describe('enabled/disabled', () => {
        it('ignores input changes when disabled', async () => {
            const ctx = createMockContext();
            await plugin.onInit(ctx);

            // Disable
            await plugin.onOutputWrite(ctx, 'enabled', false);

            await plugin.onInputChange(ctx, 'humiditySensor', { val: 90 });

            // Should not have turned on
            assert.equal(ctx._writtenForeignStates.length, 0);
        });
    });

    describe('fanStatus input', () => {
        it('updates active state from status feedback', async () => {
            const ctx = createMockContext();
            await plugin.onInit(ctx);

            await plugin.onInputChange(ctx, 'fanStatus', { val: 1 });
            assert.equal(ctx._outputStates.active.val, true);

            await plugin.onInputChange(ctx, 'fanStatus', { val: 0 });
            assert.equal(ctx._outputStates.active.val, false);
        });
    });

    describe('configurable values', () => {
        it('works with custom on/off values', async () => {
            const ctx = createMockContext({
                config: {
                    fanOnValue: 99,
                    fanOffValue: 10,
                    statusOnValue: 99,
                    statusOffValue: 10,
                },
            });
            await plugin.onInit(ctx);

            await plugin.onInputChange(ctx, 'humiditySensor', { val: 70 });
            assert.ok(ctx._writtenForeignStates.some(s => s.id === 'fan.command' && s.val === 99));

            await plugin.onInputChange(ctx, 'humiditySensor', { val: 50 });
            assert.ok(ctx._writtenForeignStates.some(s => s.id === 'fan.command' && s.val === 10));
        });

        it('works with custom presence/door values', async () => {
            const ctx = createMockContext({
                presenceSensor: 'sensor.presence',
                doorContact: 'sensor.door',
                config: {
                    presenceActiveValue: '1',
                    doorClosedValue: '0',
                },
            });
            ctx._inputStates.presenceSensor = { val: 1 };
            ctx._inputStates.doorContact = { val: 0 };

            await plugin.onInit(ctx);
            await plugin.onInputChange(ctx, 'presenceSensor', { val: 1 });

            assert.equal(ctx._outputStates.trigger.val, 'presence');
            assert.equal(ctx._outputStates.active.val, true);
        });
    });

    describe('off-delay', () => {
        it('turns off immediately when offDelay=0', async () => {
            const ctx = createMockContext({ config: { offDelay: 0 } });
            await plugin.onInit(ctx);

            await plugin.onInputChange(ctx, 'humiditySensor', { val: 70 });
            assert.equal(ctx._outputStates.active.val, true);

            await plugin.onInputChange(ctx, 'humiditySensor', { val: 50 });
            assert.equal(ctx._outputStates.active.val, false);
        });
    });

    describe('onDestroy', () => {
        it('cleans up runtime state', async () => {
            const ctx = createMockContext();
            await plugin.onInit(ctx);
            await plugin.onDestroy(ctx);

            // Subsequent init should work fine (no stale state)
            await plugin.onInit(ctx);
            assert.equal(ctx._outputStates.active.val, false);
        });
    });
});

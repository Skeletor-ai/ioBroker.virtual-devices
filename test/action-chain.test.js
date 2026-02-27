'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ActionChainExecutor } = require('../lib/action-chain');

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function createMockAdapter() {
    const states = {};
    const written = [];

    return {
        states,
        written,

        async setForeignStateAsync(id, value, ack) {
            states[id] = { val: value, ack, ts: Date.now() };
            written.push({ id, value, ack });
        },

        async getForeignStateAsync(id) {
            return states[id] || null;
        },

        async subscribeForeignStatesAsync() {},
        async unsubscribeForeignStatesAsync() {},
    };
}

const mockLog = {
    debug() {},
    info() {},
    warn() {},
    error() {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActionChainExecutor', () => {
    let adapter;
    let executor;

    beforeEach(() => {
        adapter = createMockAdapter();
        executor = new ActionChainExecutor();
    });

    describe('basic execution', () => {
        it('executes empty chain without error', async () => {
            await executor.execute(adapter, [], mockLog);
            assert.equal(adapter.written.length, 0);
        });

        it('executes single step immediately', async () => {
            const chain = [
                { objectId: 'deconz.0.relay', value: true },
            ];

            await executor.execute(adapter, chain, mockLog);

            assert.equal(adapter.written.length, 1);
            assert.equal(adapter.written[0].id, 'deconz.0.relay');
            assert.equal(adapter.written[0].value, true);
            assert.equal(adapter.written[0].ack, false);
        });

        it('executes multiple steps without wait conditions', async () => {
            const chain = [
                { objectId: 'relay', value: true },
                { objectId: 'speed', value: 2 },
                { objectId: 'mode', value: 'auto' },
            ];

            await executor.execute(adapter, chain, mockLog);

            assert.equal(adapter.written.length, 3);
            assert.equal(adapter.written[0].id, 'relay');
            assert.equal(adapter.written[1].id, 'speed');
            assert.equal(adapter.written[2].id, 'mode');
        });
    });

    describe('delay wait', () => {
        it('waits before executing step', async () => {
            const chain = [
                { objectId: 'relay', value: true },
                { objectId: 'speed', value: 2, waitBefore: { type: 'delay', ms: 50 } },
            ];

            const start = Date.now();
            await executor.execute(adapter, chain, mockLog);
            const elapsed = Date.now() - start;

            assert.equal(adapter.written.length, 2);
            assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}ms`);
        });

        it('handles 0ms delay', async () => {
            const chain = [
                { objectId: 'relay', value: true },
                { objectId: 'speed', value: 2, waitBefore: { type: 'delay', ms: 0 } },
            ];

            await executor.execute(adapter, chain, mockLog);
            assert.equal(adapter.written.length, 2);
        });
    });

    describe('state wait', () => {
        it('resolves immediately if state already at expected value', async () => {
            adapter.states['relay'] = { val: true, ack: true, ts: Date.now() };

            const chain = [
                { objectId: 'speed', value: 2, waitBefore: { type: 'state', objectId: 'relay', value: true } },
            ];

            await executor.execute(adapter, chain, mockLog);
            assert.equal(adapter.written.length, 1);
            assert.equal(adapter.written[0].id, 'speed');
        });

        it('waits for state change then continues', async () => {
            const chain = [
                { objectId: 'relay', value: true },
                { objectId: 'speed', value: 2, waitBefore: { type: 'state', objectId: 'relay', value: true, timeout: 5000 } },
            ];

            const promise = executor.execute(adapter, chain, mockLog);

            // Simulate state change after 30ms
            setTimeout(() => {
                executor.onStateChange('relay', { val: true, ack: true, ts: Date.now() });
            }, 30);

            await promise;

            assert.equal(adapter.written.length, 2);
            assert.equal(adapter.written[1].id, 'speed');
        });

        it('times out if state never reaches expected value', async () => {
            const fresh = createMockAdapter();
            const ex = new ActionChainExecutor();
            const chain = [
                { objectId: 'speed', value: 2, waitBefore: { type: 'state', objectId: 'relay', value: true, timeout: 200 } },
            ];

            let rejected = false;
            try {
                await ex.execute(fresh, chain, mockLog);
            } catch (err) {
                rejected = true;
                assert.ok(err.message.includes('Timeout'), `Expected Timeout, got: ${err.message}`);
            }
            assert.ok(rejected, 'Expected promise to reject with Timeout');
        });

        it('uses loose comparison for state values', async () => {
            adapter.states['relay'] = { val: 1, ack: true, ts: Date.now() };

            const chain = [
                { objectId: 'speed', value: 2, waitBefore: { type: 'state', objectId: 'relay', value: 'true' } },
            ];

            // 1 loose-equals 'true'? No. But '1' == 1 yes.
            // Let's test number-string matching
            adapter.states['relay'] = { val: '1', ack: true, ts: Date.now() };
            const chain2 = [
                { objectId: 'speed', value: 2, waitBefore: { type: 'state', objectId: 'relay', value: 1 } },
            ];

            await executor.execute(adapter, chain2, mockLog);
            assert.equal(adapter.written.length, 1);
        });
    });

    describe('abort', () => {
        it('aborts during delay wait', async () => {
            const chain = [
                { objectId: 'relay', value: true },
                { objectId: 'speed', value: 2, waitBefore: { type: 'delay', ms: 5000 } },
            ];

            const promise = executor.execute(adapter, chain, mockLog);

            setTimeout(() => executor.abort(), 20);

            await assert.rejects(
                () => promise,
                { message: /aborted/ }
            );

            // Only first step should have been written
            assert.equal(adapter.written.length, 1);
        });

        it('aborts during state wait', async () => {
            const chain = [
                { objectId: 'speed', value: 2, waitBefore: { type: 'state', objectId: 'relay', value: true, timeout: 5000 } },
            ];

            const promise = executor.execute(adapter, chain, mockLog);

            setTimeout(() => executor.abort(), 20);

            await assert.rejects(
                () => promise,
                { message: /aborted/ }
            );

            assert.equal(adapter.written.length, 0);
        });
    });

    describe('mixed chain', () => {
        it('executes chain with both delay and state waits', async () => {
            const chain = [
                { objectId: 'relay', value: true },
                { objectId: 'speed', value: 1, waitBefore: { type: 'delay', ms: 20 } },
                { objectId: 'speed', value: 2, waitBefore: { type: 'state', objectId: 'relay', value: true, timeout: 1000 } },
            ];

            // Pre-set relay so state wait resolves immediately
            adapter.states['relay'] = { val: true, ack: true, ts: Date.now() };

            await executor.execute(adapter, chain, mockLog);

            assert.equal(adapter.written.length, 3);
            assert.deepEqual(adapter.written.map((w) => w.id), ['relay', 'speed', 'speed']);
            assert.deepEqual(adapter.written.map((w) => w.value), [true, 1, 2]);
        });
    });

    describe('error handling', () => {
        it('propagates adapter errors', async () => {
            adapter.setForeignStateAsync = async () => {
                throw new Error('adapter offline');
            };

            const chain = [
                { objectId: 'relay', value: true },
            ];

            await assert.rejects(
                () => executor.execute(adapter, chain, mockLog),
                { message: 'adapter offline' }
            );
        });

        it('handles null chain gracefully', async () => {
            await executor.execute(adapter, null, mockLog);
            assert.equal(adapter.written.length, 0);
        });
    });
});

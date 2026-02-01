# ioBroker.virtual-devices

[![NPM version](https://img.shields.io/npm/v/iobroker.virtual-devices.svg)](https://www.npmjs.com/package/iobroker.virtual-devices)
[![License](https://img.shields.io/npm/l/iobroker.virtual-devices.svg)](https://github.com/skeletor-ai/ioBroker.virtual-devices/blob/main/LICENSE)

**Create virtual devices from existing datapoints with plugin-based logic.**

This adapter lets you combine multiple existing ioBroker datapoints into logical virtual devices. Each virtual device is powered by a plugin that defines the inputs, outputs, and automation logic.

## Features

- 🔌 **Plugin system** — extensible architecture for different device types
- 🖥️ **Device Manager UI** — no custom admin pages; everything managed via the built-in ioBroker Device Manager
- 📊 **Smart inputs** — objectId pickers with role/type/unit filters for easy datapoint selection
- 🌍 **Multilingual** — English and German translations included

## Requirements

- ioBroker >= 5.0.0
- Admin >= 6.13.16 (for Device Manager support)
- Node.js >= 18

## Installation

Install from npm (once published):

```bash
iobroker add virtual-devices
```

Or install directly from GitHub:

```bash
iobroker url https://github.com/skeletor-ai/ioBroker.virtual-devices/archive/refs/heads/main.tar.gz
```

## Getting Started

1. Install and enable the adapter
2. Open the **Device Manager** tab in the ioBroker admin sidebar
3. Find the **virtual-devices** instance and click **"Add virtual device"**
4. Select a device type (plugin), give it a name
5. Map your existing datapoints to the input slots and configure settings
6. The virtual device starts working immediately

## Built-in Plugins

### Smart Dehumidifier

Automatically controls a dehumidifier based on humidity readings, with tank-full detection via power monitoring.

**Inputs:**
| Input | Required | Description |
|-------|----------|-------------|
| Humidity Sensor | ✅ | A humidity sensor (role: `value.humidity`) |
| Power Switch | ✅ | The on/off switch for the dehumidifier |
| Power Meter | ❌ | Power consumption sensor for tank-full detection |

**Settings:**
| Setting | Default | Description |
|---------|---------|-------------|
| Target Humidity | 55% | Desired humidity level |
| Hysteresis | 3% | Prevents rapid on/off cycling |
| Tank Full Threshold | 5W | Power below this while "running" = tank full |
| Tank Full Delay | 60s | How long power must stay low before alarm |

**Output States:**
| State | Type | Description |
|-------|------|-------------|
| `running` | boolean | Whether the dehumidifier is currently on |
| `humidity` | number | Current humidity reading |
| `power` | number | Current power consumption |
| `tankFull` | boolean | Tank-full alarm |
| `enabled` | boolean | Enable/disable the automation (writable) |

**Logic:**
- Turns ON when humidity exceeds target + hysteresis
- Turns OFF when humidity drops below target
- Detects tank full when power consumption drops below threshold for the configured delay while the switch is commanded on
- Re-enabling after tank-full resets the alarm

## Writing Your Own Plugin

Create a new file in `plugins/` following the `VirtualDevicePlugin` shape (see JSDoc typedefs in `lib/plugin-interface.js`):

```javascript
'use strict';

class MyPlugin {
    constructor() {
        this.id = 'my-plugin';
        this.name = { en: 'My Plugin', de: 'Mein Plugin' };
        this.description = { en: 'Does something cool', de: 'Macht etwas Cooles' };

        this.inputSlots = [
            {
                id: 'temperature',
                name: { en: 'Temperature', de: 'Temperatur' },
                required: true,
                filter: {
                    type: 'state',
                    common: { type: 'number', role: ['value.temperature'] },
                },
            },
        ];

        this.configSchema = {
            threshold: {
                type: 'number',
                label: { en: 'Threshold', de: 'Schwellwert' },
                min: 0, max: 100,
            },
        };

        this.configDefaults = { threshold: 25 };

        this.outputStates = [
            {
                id: 'alarm',
                name: { en: 'Alarm', de: 'Alarm' },
                type: 'boolean',
                role: 'indicator.alarm',
                read: true, write: false,
            },
        ];
    }

    async onInit(ctx) {
        await ctx.setOutputState('alarm', false, true);
    }

    async onInputChange(ctx, inputId, state) {
        if (inputId === 'temperature' && state) {
            const alarm = Number(state.val) > ctx.config.threshold;
            await ctx.setOutputState('alarm', alarm, true);
        }
    }

    async onDestroy(_ctx) {
        // cleanup
    }
}

module.exports = { MyPlugin };
```

Then register it in `lib/plugin-registry.js`:

```javascript
const { MyPlugin } = require('../plugins/my-plugin');
registerPlugin(new MyPlugin());
```

## Data Structure

- **Device configs**: `virtual-devices.0.devices.{deviceId}` (channel objects with config in `native`)
- **Output states**: `virtual-devices.0.{deviceId}.{stateId}`

## Development

```bash
# Clone the repository
git clone https://github.com/skeletor-ai/ioBroker.virtual-devices.git
cd ioBroker.virtual-devices

# Install dependencies
npm install

# Syntax-check all files
node -c lib/main.js && node -c lib/plugin-registry.js && node -c lib/device-management.js && node -c plugins/smart-dehumidifier.js
```

---

## Deutsch

### Beschreibung

Erstelle virtuelle Geräte aus bestehenden ioBroker-Datenpunkten mit Plugin-basierter Logik.

### Funktionen

- 🔌 **Plugin-System** — erweiterbare Architektur für verschiedene Gerätetypen
- 🖥️ **Gerätemanager-UI** — keine eigenen Admin-Seiten; alles über den integrierten ioBroker Gerätemanager
- 📊 **Intelligente Eingänge** — ObjectID-Picker mit Rollen-/Typ-/Einheitsfiltern
- 🌍 **Mehrsprachig** — Englisch und Deutsch

### Eingebaute Plugins

#### Intelligenter Entfeuchter

Steuert automatisch einen Entfeuchter basierend auf Feuchtigkeitsmessungen mit Tank-voll-Erkennung über Leistungsüberwachung.

**Eingänge:**
| Eingang | Erforderlich | Beschreibung |
|---------|-------------|--------------|
| Feuchtigkeitssensor | ✅ | Ein Feuchtigkeitssensor (Rolle: `value.humidity`) |
| Netzschalter | ✅ | Der Ein-/Ausschalter des Entfeuchters |
| Leistungsmesser | ❌ | Verbrauchssensor für Tank-voll-Erkennung |

**Einstellungen:**
| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| Ziel-Luftfeuchtigkeit | 55% | Gewünschte Luftfeuchtigkeit |
| Hysterese | 3% | Verhindert schnelles Ein-/Ausschalten |
| Tank-voll-Schwelle | 5W | Leistung unterhalb = Tank voll |
| Tank-voll-Verzögerung | 60s | Wie lange die Leistung niedrig sein muss |

### Benutzung

1. Adapter installieren und aktivieren
2. **Gerätemanager**-Tab in der ioBroker Admin-Seitenleiste öffnen
3. **virtual-devices** Instanz finden und **"Virtuelles Gerät hinzufügen"** klicken
4. Gerätetyp auswählen, Namen vergeben
5. Vorhandene Datenpunkte den Eingangs-Slots zuordnen und Einstellungen konfigurieren
6. Das virtuelle Gerät arbeitet sofort

## Changelog

### 0.4.0 (2025-02-01)
- Feature: new Conditional Switch plugin
- Rule-based switch with up to 4 conditions (AND logic)
- Modifier input to dynamically change condition thresholds
- 2 output switches, enabled/disabled toggle

### 0.3.2 (2025-02-01)
- Fix: schedule time fields changed from free text to select dropdowns
- 48 fixed time slots (every 30 min), no invalid input possible

### 0.3.1 (2025-02-01)
- Fix: schedule fields side-by-side (from|until per row) with grid layout
- Added schedule section header

### 0.3.0 (2025-02-01)
- Feature: separate time windows per weekday (Mon–Sun each with own from/until)
- Empty day while others are configured = day disabled
- All days empty = 24/7 (no restriction)
- Replaces global time window + checkboxes

### 0.2.1 (2025-02-01)
- Feature: weekday selection for schedule (Mon–Sun checkboxes)
- All days enabled by default
- Combines with time window: day must be enabled AND time must match

### 0.2.0 (2025-02-01)
- Feature: schedule window for dehumidifier (allowed from/until HH:MM)
- Supports overnight windows (e.g. 22:00–06:00)
- Empty schedule = 24/7 operation (default)
- Auto turn-off when schedule window ends

### 0.1.8 (2025-02-01)
- Refactor: enabled toggle via DeviceInfo enabled prop + ENABLE_DISABLE action
- Removed controls, using dm-utils built-in enable/disable icon instead

### 0.1.7 (2025-02-01)
- Fix: control uses channel grouping for visible description

### 0.1.6 (2025-02-01)
- Fix: control label "Automatic control" instead of generic "Enabled"

### 0.1.5 (2025-02-01)
- Fix: UX — controls show description (what the switch does)
- Fix: UX — device details show labeled values (`<b>Label:</b> Value`)
- Fix: booleans in details displayed as ✅/❌

### 0.1.4 (2025-02-01)
- Fix: device controls need handler + getStateHandler (dm-utils requirement)

### 0.1.3 (2025-02-01)
- Fix: objectId picker — customFilter without top-level type, roles as array

### 0.1.2 (2025-02-01)
- Fix: objectId picker filter logic (customFilter → filterFunc)
- Fix: Device Manager embedded as JSONConfig tab (deviceManager component)
- Fix: author and GitHub URLs corrected to skeletor-ai
- Fix: dm property name to `deviceManagement` (dm-utils convention)

### 0.1.0 (2025-02-01)
- Initial release
- Plugin system architecture
- Smart Dehumidifier plugin
- Device Manager integration
- English and German translations

## License

MIT License — see [LICENSE](LICENSE)

### Conditional Switch (Bedingter Schalter)

Rule-based switch controller with configurable conditions and modifier support.

**Inputs:**
| Input | Required | Description |
|-------|----------|-------------|
| Switch 1 | ✅ | Primary output switch |
| Switch 2 | ❌ | Secondary output switch |
| Condition 1–4 | ❌ | Datapoints to evaluate |
| Modifier | ❌ | Trigger for alternative condition values |

**Per condition:**
| Setting | Description |
|---------|-------------|
| Operator | >, <, >=, <=, ==, != |
| Value | Normal threshold |
| Alt. Value | Used when modifier is active (optional) |

**Example — Fan with TV modifier:**
- Condition 1: Temperature > 30°C (alt: > 40°C when TV on)
- Condition 2: Door == true
- Modifier: TV == true → activates alternative values

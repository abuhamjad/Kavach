/*
 * Kavach ESP32 Firmware
 *
 * Receives newline-delimited JSON alerts from Kavach over USB serial.
 * Controls OLED, RGB LED and buzzer based on threat level.
 *
 * Hardware:
 * - ESP32 DevKit
 * - SH1106 128x64 I2C OLED (SDA=21, SCL=22)
 * - Common-anode RGB LED (RED=25, GREEN=26, BLUE=27) - Active LOW
 * - Active buzzer (GPIO 14)
 */

#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>

// ── OLED ──────────────────────────────────────────────────────────────────────
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// ── RGB LED (Common Anode - LOW = ON) ────────────────────────────────────────
const int PIN_RED   = 25;
const int PIN_GREEN = 26;
const int PIN_BLUE  = 27;

// ── Buzzer ───────────────────────────────────────────────────────────────────
const int PIN_BUZZER = 14;

// ── Serial buffer ─────────────────────────────────────────────────────────────
const int SERIAL_BUF_SIZE = 512;
char serialBuffer[SERIAL_BUF_SIZE];
int bufferPos = 0;

// ── Alert state ───────────────────────────────────────────────────────────────
String currentEvent = "";
String currentThreat = "";
String currentSector = "";
String currentPersonId = "";
bool alertActive = false;
unsigned long alertStartTime = 0;

// ── Buzzer timing (non-blocking) ─────────────────────────────────────────────
bool buzzerOn = false;
unsigned long buzzerToggleTime = 0;
int beepCount = 0;
int beepPhase = 0; // 0=ON, 1=OFF
const unsigned long BEEP_ON_MS = 150;
const unsigned long BEEP_OFF_MS = 150;
const int BEEPS_PER_CYCLE = 4;
const unsigned long CYCLE_PAUSE_MS = 600;

// ── LED update timing ─────────────────────────────────────────────────────────
unsigned long lastLedUpdate = 0;

// ════════════════════════════════════════════════════════════════════════════════

void setLedColor(const String& threat) {
  // Common anode: LOW = ON, HIGH = OFF
  if (threat == "critical" || threat == "high") {
    digitalWrite(PIN_RED, LOW);
    digitalWrite(PIN_GREEN, HIGH);
    digitalWrite(PIN_BLUE, HIGH);
  } else if (threat == "medium") {
    digitalWrite(PIN_RED, LOW);
    digitalWrite(PIN_GREEN, LOW);
    digitalWrite(PIN_BLUE, HIGH);
  } else {
    // low or default
    digitalWrite(PIN_RED, HIGH);
    digitalWrite(PIN_GREEN, LOW);
    digitalWrite(PIN_BLUE, HIGH);
  }
}

void setLedNormal() {
  digitalWrite(PIN_RED, HIGH);
  digitalWrite(PIN_GREEN, LOW);
  digitalWrite(PIN_BLUE, HIGH);
}

void updateBuzzer() {
  if (!alertActive || currentThreat == "low" || currentThreat == "medium" || currentThreat == "critical") {
    if (buzzerOn) {
      digitalWrite(PIN_BUZZER, LOW);
      buzzerOn = false;
    }
    return;
  }

  unsigned long now = millis();

  if (beepPhase == 0) {
    // ON phase (active HIGH)
    digitalWrite(PIN_BUZZER, HIGH);
    buzzerOn = true;
    if (now - buzzerToggleTime >= BEEP_ON_MS) {
      buzzerToggleTime = now;
      beepPhase = 1;
      beepCount++;
    }
  } else {
    // OFF phase
    digitalWrite(PIN_BUZZER, LOW);
    buzzerOn = false;
    if (beepCount >= BEEPS_PER_CYCLE) {
      // Cycle pause
      if (now - buzzerToggleTime >= CYCLE_PAUSE_MS) {
        buzzerToggleTime = now;
        beepPhase = 0;
        beepCount = 0;
      }
    } else if (now - buzzerToggleTime >= BEEP_OFF_MS) {
      buzzerToggleTime = now;
      beepPhase = 0;
    }
  }
}

void displayAlert() {
  u8g2.clearBuffer();
  bool highThreat = (currentThreat == "critical" || currentThreat == "high");

  // Header bar
  u8g2.setFont(u8g2_font_profont12_mf);
  u8g2.setDrawColor(1);
  u8g2.drawBox(0, 0, 128, 11);
  u8g2.setDrawColor(highThreat ? 0 : 1);
  u8g2.drawStr(3, 8, "KAVACH");
  u8g2.drawStr(88, 8, "ALERT");

  // Separator
  u8g2.setDrawColor(1);
  u8g2.drawLine(0, 11, 127, 11);

  // THREAT level
  u8g2.setFont(u8g2_font_profont12_mf);
  const char* threatVal = currentThreat == "critical" ? "CRITICAL" :
                           currentThreat == "high" ? "HIGH" :
                           currentThreat == "medium" ? "MEDIUM" : "LOW";
  u8g2.drawStr(3, 25, "THREAT:");
  u8g2.drawStr(54, 25, threatVal);

  // Separator
  u8g2.drawLine(0, 29, 127, 29);

  // EVENT row: label + value (truncate value if needed)
  u8g2.drawStr(3, 40, "EVENT:");
  const char* evt = currentEvent.length() > 0 ? currentEvent.c_str() : "-";
  u8g2.drawStr(42, 40, evt);

  // ID row
  u8g2.drawStr(3, 50, "ID:");
  const char* id = currentPersonId.length() > 0 ? currentPersonId.c_str() : "-";
  u8g2.drawStr(20, 50, id);

  // SECTOR row
  u8g2.drawStr(3, 60, "SECTOR:");
  const char* sec = currentSector.length() > 0 ? currentSector.c_str() : "-";
  u8g2.drawStr(50, 60, sec);

  // Bottom separator
  u8g2.drawLine(0, 63, 127, 63);

  u8g2.sendBuffer();
}

void displayNormal() {
  u8g2.clearBuffer();
  u8g2.setDrawColor(1);

  // Title - centered using getStrWidth
  u8g2.setFont(u8g2_font_profont15_mf);
  const char* title = "KAVACH";
  int titleW = u8g2.getStrWidth(title);
  u8g2.drawStr((128 - titleW) / 2, 14, title);

  // Separator line - full width
  u8g2.setFont(u8g2_font_profont12_mf);
  u8g2.drawLine(0, 20, 127, 20);

  // Status lines - centered
  int statusY = 30;
  const char* statusLines[] = {"SYSTEM ACTIVE", "SURVEILLANCE ONLINE", "HW: CONNECTED"};
  for (int i = 0; i < 3; i++) {
    const char* line = statusLines[i];
    int w = u8g2.getStrWidth(line);
    u8g2.drawStr((128 - w) / 2, statusY + (i * 10), line);
  }

  // Bottom separator - full width
  u8g2.drawLine(0, 60, 127, 60);

  // Footer - centered
  u8g2.setFont(u8g2_font_5x7_tf);
  const char* footer = "MONITORING";
  int fw = u8g2.getStrWidth(footer);
  u8g2.drawStr((128 - fw) / 2, 63, footer);

  u8g2.sendBuffer();
}

void processAlert(const char* event, const char* threat, const char* sector, const char* personId) {
  currentEvent = event ? event : "";
  currentThreat = threat ? threat : "low";
  currentSector = sector ? sector : "";
  currentPersonId = personId ? personId : "";

  alertActive = true;
  alertStartTime = millis();
  beepCount = 0;
  beepPhase = 0;
  buzzerToggleTime = millis();

  setLedColor(currentThreat);
  displayAlert();
}

void clearAlert() {
  alertActive = false;
  currentEvent = "";
  currentThreat = "";
  currentSector = "";
  currentPersonId = "";

  setLedNormal();
  displayNormal();

  if (buzzerOn) {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerOn = false;
  }
}

void parseJsonLine(const char* line) {
  // Simple JSON parser for alert messages
  // Expected format: {"type":"alert","event":"tripwire","threat":"high","sector":"SECTOR-A","person_id":17}

  if (strstr(line, "\"type\"") == NULL || strstr(line, "\"alert\"") == NULL) {
    return;
  }

  char event[32] = {0};
  char threat[16] = {0};
  char sector[32] = {0};
  char personId[16] = {0};

  // Extract event
  const char* p = strstr(line, "\"event\"");
  if (p) {
    p = strchr(p, ':');
    if (p) {
      p = strchr(p, '"');
      if (p) {
        p++;
        int i = 0;
        while (*p && *p != '"' && i < 31) {
          event[i++] = *p++;
        }
        event[i] = 0;
      }
    }
  }

  // Extract threat
  p = strstr(line, "\"threat\"");
  if (p) {
    p = strchr(p, ':');
    if (p) {
      p = strchr(p, '"');
      if (p) {
        p++;
        int i = 0;
        while (*p && *p != '"' && i < 15) {
          threat[i++] = *p++;
        }
        threat[i] = 0;
      }
    }
  }

  // Extract sector
  p = strstr(line, "\"sector\"");
  if (p) {
    p = strchr(p, ':');
    if (p) {
      p = strchr(p, '"');
      if (p) {
        p++;
        int i = 0;
        while (*p && *p != '"' && i < 31) {
          sector[i++] = *p++;
        }
        sector[i] = 0;
      }
    }
  }

  // Extract person_id (number, not string)
  p = strstr(line, "\"person_id\"");
  if (p) {
    p = strchr(p, ':');
    if (p) {
      p++;
      while (*p && (*p < '0' || *p > '9')) p++;
      if (*p) {
        int i = 0;
        while (*p && *p >= '0' && *p <= '9' && i < 15) {
          personId[i++] = *p++;
        }
        personId[i] = 0;
      }
    }
  }

  processAlert(event, threat, sector, personId);
}

void setup() {
  Serial.begin(115200);

  // Initialize LED pins (common anode = OFF by default)
  pinMode(PIN_RED, OUTPUT);
  pinMode(PIN_GREEN, OUTPUT);
  pinMode(PIN_BLUE, OUTPUT);
  digitalWrite(PIN_RED, HIGH);
  digitalWrite(PIN_GREEN, HIGH);
  digitalWrite(PIN_BLUE, HIGH);

  // Initialize buzzer pin (active HIGH)
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Initialize OLED
  Wire.begin(21, 22);
  u8g2.begin();
  displayNormal();
  setLedNormal();
}

void loop() {
  // Read serial data
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (bufferPos > 0) {
        serialBuffer[bufferPos] = 0;
        parseJsonLine(serialBuffer);
        bufferPos = 0;
      }
    } else if (bufferPos < SERIAL_BUF_SIZE - 1) {
      serialBuffer[bufferPos++] = c;
    }
  }

  // Update buzzer (non-blocking)
  updateBuzzer();

  // Refresh display if alert active
  if (alertActive) {
    unsigned long now = millis();
    if (now - lastLedUpdate > 500) {
      displayAlert();
      lastLedUpdate = now;
    }
  }
}

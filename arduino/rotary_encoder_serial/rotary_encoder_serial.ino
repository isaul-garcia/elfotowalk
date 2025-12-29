// Rotary encoder to serial bridge for KY-040 style modules.
// Sends "ROT:+1" or "ROT:-1" for each detent and "BTN:1" on button press.

// Update these three to match your ESP8266 pins.
// For NodeMCU/D1 mini: GPIO14 (D5), GPIO12 (D6), GPIO13 (D7).
// If your board core doesn't define D5/D6/D7 names, the defines below provide them.
#ifndef D5
#define D5 14
#endif
#ifndef D6
#define D6 12
#endif
#ifndef D7
#define D7 13
#endif
#ifndef D1
#define D1 5
#endif
const int clkPin = D5; // CLK on encoder
const int dtPin  = D6; // DT on encoder
const int swPin  = D7; // SW (push button)
const int sw2Pin = D1; // second button

const bool debugPins = true; // print raw pin states once per second to verify wiring
unsigned long lastDebugMs = 0;

int lastClk = LOW;
unsigned long lastButtonMs = 0;
unsigned long lastButton2Ms = 0;
const unsigned long debounceMs = 80;

void setup() {
  // Pull-ups keep the encoder lines stable at HIGH until a detent closes to GND.
  pinMode(clkPin, INPUT_PULLUP);
  pinMode(dtPin, INPUT_PULLUP);
  pinMode(swPin, INPUT_PULLUP); // internal pull-up for the button
  pinMode(sw2Pin, INPUT_PULLUP); // second button
  Serial.begin(115200);
  Serial.println("READY");
  lastClk = digitalRead(clkPin);
}

void loop() {
  // Rotary movement: simple edge check (works reliably on many KY-040s)
  int currentClk = digitalRead(clkPin);
  if (currentClk != lastClk && currentClk == HIGH) { // act on rising edge only
    int dtState = digitalRead(dtPin);
    if (dtState != currentClk) {
      Serial.println("ROT:-1"); // counter-clockwise
    } else {
      Serial.println("ROT:1");  // clockwise
    }
  }
  lastClk = currentClk;

  // Button press (active LOW)
  if (digitalRead(swPin) == LOW) {
    unsigned long now = millis();
    if (now - lastButtonMs > debounceMs) {
      Serial.println("BTN:1");
      lastButtonMs = now;
    }
  }
  if (digitalRead(sw2Pin) == LOW) {
    unsigned long now = millis();
    if (now - lastButton2Ms > debounceMs) {
      Serial.println("BTN2:1");
      lastButton2Ms = now;
    }
  }

  // Wiring sanity: emit pin levels periodically.
  if (debugPins && millis() - lastDebugMs > 1000) {
    lastDebugMs = millis();
    Serial.print("DBG CLK:");
    Serial.print(digitalRead(clkPin));
    Serial.print(" DT:");
    Serial.print(digitalRead(dtPin));
    Serial.print(" SW:");
    Serial.println(digitalRead(swPin));
  }
}

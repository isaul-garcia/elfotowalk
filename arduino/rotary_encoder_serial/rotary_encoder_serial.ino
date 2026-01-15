// Rotary encoder + joystick + extra buttons → serial bridge.
// UNO pin map (adjust if you rewired):
//   Encoder CLK → D2, DT → D3, SW → D4
//   Joystick X → A0, Y → A1, SW → D5
//   Extra buttons → D6, D7, D8
// Emits:
//   ROT:+1 / ROT:-1     (encoder turns)
//   BTN:1               (encoder push)
//   BTN2:1              (extra button on D6)
//   BTN3:1              (extra button on D7)
//   BTN4:1              (extra button on D8)
//   JOYBTN:1            (joystick push)
//   JOY:<x>,<y>         (joystick axes, 0–1023), only when moved past a threshold

const int clkPin = 2;   // encoder CLK
const int dtPin  = 3;   // encoder DT
const int swPin  = 4;   // encoder push button

const int joyXPin = A0; // joystick X
const int joyYPin = A1; // joystick Y
const int joyBtnPin = 5;// joystick push

const int btn2Pin = 6;  // extra button 1
const int btn3Pin = 7;  // extra button 2
const int btn4Pin = 8;  // extra button 3

const bool debugPins = false; // set true to print raw pin states once per second
unsigned long lastDebugMs = 0;

int lastClk = LOW;
unsigned long lastButtonMs = 0;
unsigned long lastButton2Ms = 0;
unsigned long lastButton3Ms = 0;
unsigned long lastButton4Ms = 0;
unsigned long lastJoyBtnMs = 0;
const unsigned long debounceMs = 80;
int lastSwState = HIGH;
int lastBtn2State = HIGH;
int lastBtn3State = HIGH;
int lastBtn4State = HIGH;
int lastJoyBtnState = HIGH;

// Joystick change reporting
int lastJoyX = -1;
int lastJoyY = -1;
unsigned long lastJoyMs = 0;
unsigned long lastJoyEmitMs = 0;
const unsigned long joyPollMs = 20;     // read joystick every 20 ms
const unsigned long joyMinEmitMs = 120; // force emit even if unchanged
const int joyDelta = 8;                 // min delta to consider movement

void setup() {
  // Pull-ups keep the encoder lines stable at HIGH until a detent closes to GND.
  pinMode(clkPin, INPUT_PULLUP);
  pinMode(dtPin, INPUT_PULLUP);
  pinMode(swPin, INPUT_PULLUP); // internal pull-up for the button
  pinMode(btn2Pin, INPUT_PULLUP); // extra button 1
  pinMode(btn3Pin, INPUT_PULLUP); // extra button 2
  pinMode(btn4Pin, INPUT_PULLUP); // extra button 3
  pinMode(joyBtnPin, INPUT_PULLUP);
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

  // Buttons (active LOW)
  unsigned long now = millis();
  int swState = digitalRead(swPin);
  if (swState == LOW && lastSwState == HIGH && now - lastButtonMs > debounceMs) {
    Serial.println("BTN:1");
    lastButtonMs = now;
  }
  lastSwState = swState;

  int btn2State = digitalRead(btn2Pin);
  if (btn2State == LOW && lastBtn2State == HIGH && now - lastButton2Ms > debounceMs) {
    Serial.println("BTN2:1");
    lastButton2Ms = now;
  }
  lastBtn2State = btn2State;

  int btn3State = digitalRead(btn3Pin);
  if (btn3State == LOW && lastBtn3State == HIGH && now - lastButton3Ms > debounceMs) {
    Serial.println("BTN3:1");
    lastButton3Ms = now;
  }
  lastBtn3State = btn3State;

  int btn4State = digitalRead(btn4Pin);
  if (btn4State == LOW && lastBtn4State == HIGH && now - lastButton4Ms > debounceMs) {
    Serial.println("BTN4:1");
    lastButton4Ms = now;
  }
  lastBtn4State = btn4State;

  int joyBtnState = digitalRead(joyBtnPin);
  if (joyBtnState == LOW && lastJoyBtnState == HIGH && now - lastJoyBtnMs > debounceMs) {
    Serial.println("JOYBTN:1");
    lastJoyBtnMs = now;
  }
  lastJoyBtnState = joyBtnState;

  // Joystick axes: emit when moved enough or on a periodic refresh
  if (now - lastJoyMs >= joyPollMs) {
    lastJoyMs = now;
    int x = analogRead(joyXPin);
    int y = analogRead(joyYPin);

    if (lastJoyX < 0) { lastJoyX = x; }
    if (lastJoyY < 0) { lastJoyY = y; }

    bool changed = (abs(x - lastJoyX) > joyDelta) || (abs(y - lastJoyY) > joyDelta);
    bool timeToRefresh = (now - lastJoyEmitMs) > joyMinEmitMs;
    if (changed || timeToRefresh) {
      lastJoyX = x;
      lastJoyY = y;
      lastJoyEmitMs = now;
      Serial.print("JOY:");
      Serial.print(x);
      Serial.print(",");
      Serial.println(y);
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
    Serial.print(digitalRead(swPin));
    Serial.print(" BTN2:");
    Serial.print(digitalRead(btn2Pin));
    Serial.print(" BTN3:");
    Serial.print(digitalRead(btn3Pin));
    Serial.print(" BTN4:");
    Serial.print(digitalRead(btn4Pin));
    Serial.print(" JOYBTN:");
    Serial.println(digitalRead(joyBtnPin));
  }
}

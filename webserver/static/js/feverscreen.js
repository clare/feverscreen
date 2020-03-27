// Top of JS
window.onload = async function() {
  console.log("LOAD");
  let GThreshold_fever = 38.8;
  let GThreshold_check = 37.8;

  let GCalibrate_temperature_celsius = 37;
  let GCalibrate_snapshot_value = 10;
  let GCurrent_hot_value = 10;
  let debugMode = false;
  let neverCalibrated = true;
  const slope = 0.01;
  const FRAME_WIDTH = 160;
  const FRAME_HEIGHT = 120;
  const Modes = {
    INIT: 0,
    CALIBRATE: 1,
    SCAN: 2,
    WAITING: 3,
  };
  let Mode = Modes.INIT;
  /*
  const fahrenheitToCelsius = f => ((f - 32.0) * 5) / 9;
  const celsiusToFahrenheit = c => (c * 9.0) / 5 + 32;
   */

  const temperatureInputCelsius = document.getElementById(
    "temperature_input_a"
  );
  const calibrationOverlay = document.getElementById("myNav");
  const mainCanvas = document.getElementById("main_canvas");
  const debugCanvas = document.getElementById("debug-canvas");
  const calibrationButton = document.getElementById("calibration_button");
  const scanButton = document.getElementById("scan_button");
  const temperatureDiv = document.getElementById("temperature_div");
  const tempInput = document.getElementById("temperature_input_a");
  const thumbHot = document.getElementById("thumb_hot");
  const thumbQuestion = document.getElementById("thumb_question");
  const thumbNormal = document.getElementById("thumb_normal");
  const titleDiv = document.getElementById("title_div");
  const settingsDiv = document.getElementById("settings");
  const temperatureDisplay = document.getElementById("temperature_display");
  const overlayMessage = document.getElementById("overlay-message");
  const ctx = mainCanvas.getContext("2d");
  const debugCtx = debugCanvas.getContext('2d');

  let prefix = "";
  if (window.location.hostname === "localhost") {
    prefix = "http://192.168.178.37";
  }

  const CAMERA_RAW = `${prefix}/camera/snapshot-raw`;

  document.getElementById("warmer").addEventListener("click", () => {
    setCalibrateTemperatureSafe(GCalibrate_temperature_celsius + 0.1);
  });

  document.getElementById("cooler").addEventListener("click", () => {
    setCalibrateTemperatureSafe(GCalibrate_temperature_celsius - 0.1);
  });

  document
    .getElementById("calibration_button")
    .addEventListener("click", () => startCalibration());

  document
    .getElementById("scan_button")
    .addEventListener("click", () => startScan());

  document.getElementById("debug-button").addEventListener('click', (event) => {
    debugMode = !debugMode;
    if (debugMode) {
      event.target.innerText = "Hide Debug";
    } else {
      event.target.innerText = "Show Debug";
    }
  });

  temperatureInputCelsius.addEventListener("input", event => {
    setCalibrateTemperature(
      parseFloat(event.target.value),
      temperatureInputCelsius
    );
  });

  function isUnreasonableCalibrateTemperature(temperatureCelsius) {
    if (temperatureCelsius < 10 || temperatureCelsius > 90) {
      return true;
    }
    return isNaN(temperatureCelsius);
  }

  function setCalibrateTemperature(temperatureCelsius) {
    if (isUnreasonableCalibrateTemperature(temperatureCelsius)) {
      return;
    }
    if (neverCalibrated) {
      scanButton.removeAttribute("disabled");
      neverCalibrated = false;
    }
    tempInput.value = temperatureCelsius.toFixed(1);
    GCalibrate_temperature_celsius = temperatureCelsius;
  }

  function setCalibrateTemperatureSafe(temperature_celsius) {
    if (isUnreasonableCalibrateTemperature(temperature_celsius)) {
      temperature_celsius = 35.6;
    }
    setCalibrateTemperature(temperature_celsius);
  }

  function showTemperature(temp_celsius) {
    const icons = [thumbHot, thumbQuestion, thumbNormal];
    let selectedIcon;
    let state = "null";
    if (temp_celsius > 45) {
      // ERROR
      state = "error";
      selectedIcon = thumbHot;
    } else if (temp_celsius > GThreshold_fever) {
      // FEVER
      state = "fever";
      selectedIcon = thumbHot;
    } else if (temp_celsius > GThreshold_check) {
      // CHECK
      state = "check";
      selectedIcon = thumbQuestion;
    } else if (temp_celsius > 35.5) {
      // NORMAL
      state = "normal";
      selectedIcon = thumbNormal;
    }
    temperatureDisplay.innerHTML = `${temp_celsius.toFixed(1)}&deg;&nbsp;C`;
    temperatureDiv.classList.remove(
      "normal-state",
      "check-state",
      "error-state",
      "fever-state"
    );
    temperatureDiv.classList.add(`${state}-state`);
    for (const icon of icons) {
      if (icon === selectedIcon) {
        icon.classList.add("selected");
      } else {
        icon.classList.remove("selected");
      }
    }
  }


  function sampleBackgroundAt(rawData, xPos, yPos) {
    const sampleSide = 10;
    let accum = 0;
    for (let y = yPos - (sampleSide * 0.5); y < yPos + (sampleSide * 0.5); y++) {
      for (let x = xPos - (sampleSide * 0.5); x < xPos + (sampleSide * 0.5); x++) {
        accum += rawData[(y * FRAME_WIDTH) + x];
      }
    }
    return estimatedTemperatureForValue(accum / (sampleSide * sampleSide));
  }

  function estimatedTemperatureForValue(value) {
    return GCalibrate_temperature_celsius +
    (value - GCalibrate_snapshot_value) * slope;
  }

  const averageTempTracking = [];
  let initialTemp = 0;
  function processSnapshotRaw(rawData) {
    const imgData = ctx.getImageData(0, 0, 160, 120);
    const darkValue = Math.min(...rawData);
    const hotValue = Math.max(...rawData);
    GCurrent_hot_value = hotValue;

    let feverThreshold = 1<<16;
    let checkThreshold = 1<<16;

    if (Mode === Modes.CALIBRATE) {
      GCalibrate_snapshot_value = GCurrent_hot_value;
    }
    if (Mode === Modes.SCAN) {
      const temperature = estimatedTemperatureForValue(hotValue);
      feverThreshold =
        (GThreshold_fever - GCalibrate_temperature_celsius) / slope +
        GCalibrate_snapshot_value;
      checkThreshold =
        (GThreshold_check - GCalibrate_temperature_celsius) / slope +
        GCalibrate_snapshot_value;
      showTemperature(temperature);
    }

    const dynamicRange = 255 / (hotValue - darkValue);
    let p = 0;
    for (const u16Val of rawData) {
      const v = (u16Val - darkValue) * dynamicRange;
      let r = v;
      let g = v;
      let b = v;
      if (feverThreshold < u16Val) {
        r = 255;
        g *= 0.5;
        b *= 0.5;
      } else if (checkThreshold < u16Val) {
        r = 192;
        g = 192;
        b *= 0.5;
      }
      imgData.data[p] = r;
      imgData.data[p + 1] = g;
      imgData.data[p + 2] = b;
      imgData.data[p + 3] = 255;
      p += 4;
    }
    ctx.putImageData(imgData, 0, 0);
    drawDebugInfo(rawData);
  }

  function drawDebugInfo(rawData) {
    let width = debugCanvas.offsetWidth;
    let height = debugCanvas.offsetHeight;
    debugCanvas.width = width;
    debugCanvas.height = height;
    if (debugMode) {
      const topLeft = sampleBackgroundAt(rawData, 6, 6);
      const topRight = sampleBackgroundAt(rawData, FRAME_WIDTH - 6, 6);
      const bottomLeft = sampleBackgroundAt(rawData, 6, FRAME_HEIGHT - 6);
      const bottomRight = sampleBackgroundAt(rawData, FRAME_WIDTH - 6, FRAME_HEIGHT - 6);
      const topMiddle = sampleBackgroundAt(rawData, FRAME_WIDTH * 0.5, 6);
      const leftMiddle = sampleBackgroundAt(rawData, 6, FRAME_HEIGHT * 0.5);
      const rightMiddle = sampleBackgroundAt(rawData, FRAME_WIDTH - 6, FRAME_HEIGHT * 0.5);
      const samples = [topLeft, topRight, bottomLeft, bottomRight, topMiddle, leftMiddle, rightMiddle];
      const averageSample = samples.reduce((acc, i) => acc + i, 0) / samples.length;
      if (!initialTemp) {
        initialTemp = averageSample;
      }

      averageTempTracking.push(averageSample);
      if (averageTempTracking.length > width) {
        averageTempTracking.shift();
      }
      const halfDegree = height * 0.5 * 0.5;

      debugCtx.fillStyle = '#bb6922';
      // Draw the graph of the recent temp, with a midline for the start value.
      for (let x = 0; x < averageTempTracking.length; x++) {
        // One degree spans 50 pixels here
        debugCtx.fillRect(x, height / 2, 1, (initialTemp - averageTempTracking[x]) * halfDegree);
      }
      debugCtx.fillStyle = 'red';
      debugCtx.fillRect(0, (height / 2) - halfDegree, width, 1);
      debugCtx.fillStyle = 'blue';
      debugCtx.fillRect(0, (height / 2) + halfDegree, width, 1);
      debugCtx.fillStyle = 'white';
      debugCtx.fillRect(0, (height / 2), width, 1);
    } else {
      debugCtx.clearRect(0, 0, width, height);
    }
  }

  // TODO: Click on the canvas to center the region where you'd like to evaluate temperature.
  // TODO: Take an average of a square near the top right/left and use it to track drift, have a rolling
  //  average.

  let duringCalibration = false;
  async function fetchFrameDataAndTelemetry() {
    try {
      const response = await fetch(`${CAMERA_RAW}?${new Date().getTime()}`, {
        method: "GET",
        headers: {
          Authorization: `Basic ${btoa("admin:feathers")}`
        }
      });
      const metadata = JSON.parse(response.headers.get("Telemetry"));
      const data = await response.arrayBuffer();
      if (data.byteLength > 13) {
        const typedData = new Uint16Array(data);
        if (
          metadata.FFCState !== "complete" ||
          metadata.TimeOn - metadata.LastFFCTime < 60 * 1000 * 1000 * 1000
        ) {
          openNav("Automatic calibration in progress. Please wait.");
          duringCalibration = true;
        } else {
          if (duringCalibration) {
            // We just exited calibration, so clear our debug info
            initialTemp = 0;
            averageTempTracking.length = 0;
            duringCalibration = false;
          }
          closeNav();
        }
        if (typedData.length === 160 * 120) {
          processSnapshotRaw(typedData);
        }
        setTimeout(fetchFrameDataAndTelemetry, Math.floor(1000 / 9));
      } else {
        Mode = Modes.WAITING;
        // No frames yet
        openNav("Waiting for camera response...");
        // Back-off from hammering the server so often
        setTimeout(fetchFrameDataAndTelemetry, 2000);
      }
    } catch (err) {
      console.log("error:", err);
      // Back-off from hammering the server so often
      setTimeout(fetchFrameDataAndTelemetry, 5000);
    }
  }

  function openNav(text) {
    calibrationOverlay.classList.add("show");
    overlayMessage.innerText = text;
  }

  function closeNav() {
    calibrationOverlay.classList.remove("show");
  }

  function hasBeenCalibratedRecently() {
    return true;
  }

  function nosleep_enable() {
    new NoSleep().enable();
  }

  function setTitle(text) {
    titleDiv.innerText = text;
  }

  function startCalibration(initial = false) {
    // Start calibration
    Mode = Modes.CALIBRATE;
    calibrationButton.setAttribute("disabled", "disabled");
    scanButton.removeAttribute("disabled");
    settingsDiv.classList.remove("show-scan");
    setTitle("Calibrate");
    if (!initial) {
      nosleep_enable();
    }
  }

  function startScan(initial = false) {
    // Go into scanning mode
    Mode = Modes.SCAN;
    calibrationButton.removeAttribute("disabled");
    scanButton.setAttribute("disabled", "disabled");
    settingsDiv.classList.add("show-scan");
    setTitle("Scanning...");
    if (!initial) {
      nosleep_enable();
    }
  }

  if (Mode === Modes.INIT || !hasBeenCalibratedRecently()) {
    startCalibration(true);
    if (neverCalibrated) {
      scanButton.setAttribute("disabled", "disabled");
    }
  } else {
    startScan(true);
  }
  await fetchFrameDataAndTelemetry();
};
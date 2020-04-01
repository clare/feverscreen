// Top of JS
window.onload = async function() {

  //these are the *lowest* temperature in celsius for each category
  let GThreshold_error = 42.5;
  let GThreshold_fever = 37.8;
  let GThreshold_check = 37.4;
  let GThreshold_normal = 35.7;
  let GThreshold_cold = 32.5;
  let GDisplay_precision = 2;

  let GThreshold_uncertainty = 0.5;

  let GStable_correction = 0;
  let GStable_correction_accumulator = 0;
  let GStable_uncertainty = 0.7;

  let fetch_frame_delay = 100;
  let GTimeSinceFFC = 0;

  let GCalibrate_temperature_celsius = 37;
  let GCalibrate_snapshot_value = 0;
  let GCalibrate_snapshot_uncertainty = 100;
  let GCalibrate_snapshot_time = 0;

  let GCurrent_hot_value = 10;
  let GDevice_temperature = 10;
  let debugMode = false;
  const slope = 0.03136;
  const frameWidth = 160;
  const frameHeight = 120;
  const Modes = {
    INIT: 0,
    CALIBRATE: 1,
    SCAN: 2
  };
  let Mode = Modes.INIT;

  // radial smoothing kernel.
  const kernel = new Float32Array(7);
  const radius = 3;
  let i = 0;
  for (let r = -radius; r <= radius; r++) {
    kernel[i++] = Math.exp((-3 * (r * r)) / radius / radius);
  }

  const fahrenheitToCelsius = f => (f - 32.0) * (5.0 / 9);
  const celsiusToFahrenheit = c => c * (9.0 / 5) + 32;

  const temperatureInputCelsius = document.getElementById(
    "temperature_input_a"
  );
  const temperatureInputLabel = document.getElementById("temperature_label");

  const calibrationOverlay = document.getElementById("myNav");
  const mainCanvas = document.getElementById("main_canvas");
  let canvasWidth = mainCanvas.width;
  let canvasHeight = mainCanvas.height;
  const scanButton = document.getElementById("scan_button");
  const temperatureDiv = document.getElementById("temperature_div");
  const temperatureInput = document.getElementById("temperature_input_a");
  const thumbCold = document.getElementById("thumb_cold");
  const thumbHot = document.getElementById("thumb_hot");
  const thumbQuestion = document.getElementById("thumb_question");
  const thumbNormal = document.getElementById("thumb_normal");
  const titleDiv = document.getElementById("title_div");
  const settingsDiv = document.getElementById("settings");
  const temperatureDisplay = document.getElementById("temperature_display");
  const overlayMessage = document.getElementById("overlay-message");
  const overlayCanvas = document.getElementById('overlay-canvas');
  const statusText = document.getElementById("status-text");
  const ctx = mainCanvas.getContext("2d");
  let overlayCtx;
  // Set initial size of overlay canvas to the native resolution.
  // NOTE: We currently don't handle resizing, since we're mostly targeting mobile devices.
  const overlayWidth = overlayCanvas.offsetWidth;
  const overlayHeight = overlayCanvas.offsetHeight;
  let overlayTextTimeout;
  let nativeOverlayWidth;
  let nativeOverlayHeight;
  {
    overlayCanvas.width = overlayWidth * window.devicePixelRatio;
    overlayCanvas.height = overlayHeight * window.devicePixelRatio;
    nativeOverlayWidth = overlayCanvas.width;
    nativeOverlayHeight = overlayCanvas.height;
    overlayCanvas.style.width = `${overlayWidth}px`;
    overlayCanvas.style.height = `${overlayHeight}px`;
    overlayCtx = overlayCanvas.getContext('2d');
  }
  setOverlayMessages("Loading");

  let prefix = "";
  if (window.location.hostname === "localhost") {
    //prefix = "http://192.168.178.37";
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
    .getElementById("admin_button")
    .addEventListener("click", () => openNav("Admin (placeholder)"));

  document
    .getElementById("admin_close_button")
    .addEventListener("click", () => {
      closeNav();
    });

  const GNoSleep = new NoSleep();
  document.getElementById("scan_button").addEventListener("click", () => {
    GNoSleep.enable();
    startScan();
  });

  temperatureInputCelsius.addEventListener("input", event => {
    let entry_value = parseFloat(event.target.value);
    if (entry_value < 75) {
      temperatureInputLabel.innerHTML = "&deg;C";
    } else {
      temperatureInputLabel.innerHTML = "&deg;F";
      entry_value = fahrenheitToCelsius(entry_value);
    }

    setCalibrateTemperature(entry_value, temperatureInputCelsius);
  });

  showLoadingSnow();
  initCalibrateTemperatureLocalStorage();

  function isUnreasonableCalibrateTemperature(temperatureCelsius) {
    if (temperatureCelsius < 10 || temperatureCelsius > 90) {
      return true;
    }
    return isNaN(temperatureCelsius);
  }

  function setCalibrateTemperatureLocalStorage(s) {
    try {
      let localStorage = window.localStorage;
      localStorage.setItem("CalibrateTemperature001", s);
    } catch (err) {}
  }

  function initCalibrateTemperatureLocalStorage() {
    try {
      let localStorage = window.localStorage;
      const s = localStorage.getItem("CalibrateTemperature001");
      const temperatureCelsius = parseFloat(s);
      setCalibrateTemperature(temperatureCelsius);
    } catch (err) {}
  }

  function setCalibrateTemperature(temperatureCelsius, excludeElement = null) {
    if (isUnreasonableCalibrateTemperature(temperatureCelsius)) {
      return;
    }
    GCalibrate_temperature_celsius = temperatureCelsius;
    setCalibrateTemperatureLocalStorage(GCalibrate_temperature_celsius);
    if (excludeElement !== temperatureInput) {
      temperatureInput.value = temperatureCelsius.toFixed(GDisplay_precision);
      temperatureInputLabel.innerHTML = "&deg;C";
    }
  }

  function setCalibrateTemperatureSafe(temperature_celsius) {
    if (isUnreasonableCalibrateTemperature(temperature_celsius)) {
      temperature_celsius = 35.6;
    }
    setCalibrateTemperature(temperature_celsius);
  }

  function showTemperature(temperature_celsius, uncertainty_celsius) {
    const icons = [thumbCold, thumbHot, thumbQuestion, thumbNormal];
    let selectedIcon;
    let state = "null";
    let descriptor = "Empty";

    if(uncertainty_celsius > GThreshold_uncertainty) {
      descriptor = "Uncalibrated";
      selectedIcon = thumbHot;
    } else if (temperature_celsius > GThreshold_error) {
      descriptor = "Error";
      state = "error";
      selectedIcon = thumbHot;
      if (((new Date().getTime() * 3) / 1000) & 1) {
        state = "error2";
      }
    } else if (temperature_celsius > GThreshold_fever) {
      descriptor = "Fever";
      state = "fever";
      selectedIcon = thumbHot;
    } else if (temperature_celsius > GThreshold_check) {
      descriptor = "Check";
      state = "check";
      selectedIcon = thumbQuestion;
    } else if (temperature_celsius > GThreshold_normal) {
      descriptor = "Normal";
      state = "normal";
      selectedIcon = thumbNormal;
    } else if (temperature_celsius > GThreshold_cold) {
      descriptor = "Cold";
      state = "cold";
      selectedIcon = thumbCold;
    }
    const strC = `${temperature_celsius.toFixed(GDisplay_precision)}&deg;C`;
    const strPM = `&plusmn;${uncertainty_celsius.toFixed(GDisplay_precision)}&deg;C`;
    let strDisplay = `<span class="msg-1">${strC}</span>`;
    strDisplay += `<span class="msg-1">${strPM}</span>`;
    strDisplay += `<span class="msg-2">${descriptor}</span>`;
    if (true) {
      strDisplay +=
        "<br> HV:" +
        (GCurrent_hot_value/100).toFixed(2) +
        "<br> Tdev:" +
        GDevice_temperature.toFixed(GDisplay_precision) +
        "&deg;C";
      strDisplay += '<br>TFC:' + GTimeSinceFFC.toFixed(1)+'s';
      selectedIcon = undefined;
    }
    if (duringFFC) {
      setTitle('Please wait')
      strDisplay = "<span class='msg-1'>Calibrating</span>";
    }
    if (GCalibrate_snapshot_value == 0) {
      strDisplay = "<span class='msg-1'>Calibration required</span>";
    }
    temperatureDisplay.innerHTML = strDisplay;
    temperatureDiv.classList.remove(
      "check-state",
      "cold-state",
      "error-state",
      "error2-state",
      "normal-state",
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

  function requestUserRecalibration() {
    // NOTE: Call this whenever a user recalibration step is required
    startCalibration("Recalibrate");
    setOverlayMessages("Please recalibrate");
  }

  function estimatedTemperatureForValue(value) {
    return (
      GCalibrate_temperature_celsius +
      (value - GCalibrate_snapshot_value) * slope
    );
  }

  function estimatedUncertaintyForValue(value, include_calibration = true) {
    let result = 0.00;

    result += 0.03; // uncertainty just from the sensor alone


    if (include_calibration) {
      let seconds_since_calibration = (new Date().getTime() - GCalibrate_snapshot_time) / (1000)
      result += GCalibrate_snapshot_uncertainty * Math.min(seconds_since_calibration / 60, 1);

      const worst_drift_in_10_minutes_celsius = 0.5;
      result += seconds_since_calibration * worst_drift_in_10_minutes_celsius / 600;
    }

    if (GTimeSinceFFC < 10) {
        result += 0.8;
    } else if (GTimeSinceFFC < 90) {
        result += 0.2 * (90 - GTimeSinceFFC) / 90;
    }

    //...

    return result;
  }

  function setOverlayMessages(...messages) {
    let overlayHTML = "";
    for (const message of messages) {
      overlayHTML += `<span>${message}</span>`;
    }

    if (overlayHTML === '') {
      statusText.classList.remove("has-message");
      overlayTextTimeout = setTimeout(() => {
        statusText.innerHTML = overlayHTML;
      }, 500);

    } else {
      if (overlayTextTimeout !== undefined) {
        clearTimeout(overlayTextTimeout);
      }
      statusText.classList.add("has-message");
      statusText.innerHTML = overlayHTML;
    }
  }

  function showLoadingSnow(alpha = 1) {
    let imgData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    let beta = 1 - alpha;
    for (let i = 0; i < imgData.data.length; i += 4) {
      const v = Math.random() * 128;
      imgData.data[i + 0] = v * alpha + imgData.data[i + 0] * beta;
      imgData.data[i + 1] = v * alpha + imgData.data[i + 1] * beta;
      imgData.data[i + 2] = v * alpha + imgData.data[i + 2] * beta;
      imgData.data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function median_three(a, b, c) {
    if (a <= b && b <= c) return b;
    if (c <= b && b <= a) return b;

    if (b <= a && a <= c) return a;
    if (c <= a && a <= b) return a;

    return c;
  }

  function median_smooth_pass(source, delta, swizzle) {
    let x0 = 2;
    let x1 = frameWidth - 2;
    let dx = 1;
    let y0 = 2;
    let y1 = frameHeight - 2;
    let dy = 1;
    if (swizzle & 1) {
      [x0, x1] = [x1, x0];
      dx = -dx;
    }
    if (swizzle & 2) {
      [y0, y1] = [y1, y0];

      dy = -dy;
    }
    for (let y = y0; y !== y1; y += dy) {
      for (let x = x0; x !== x1; x += dx) {
        let index = y * frameWidth + x;
        let current = source[index];
        const value = median_three(
          source[index - delta],
          current,
          source[index + delta]
        );
        source[index] = (current * 3 + value) / 4;
      }
    }
    return source;
  }

  function median_smooth(source) {
    source = median_smooth_pass(source, 1, 0);
    source = median_smooth_pass(source, frameWidth, 0);
    source = median_smooth_pass(source, frameWidth, 3);
    source = median_smooth_pass(source, 1, 3);
    return source;
  }

  function radial_smooth_half(source, width, height) {
    const dest = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let indexS = y * width + x;
        let indexD = x * height + y;
        let value = 0;
        let kernel_sum = 0;

        let r0 = Math.max(-x, -radius);
        let r1 = Math.min(width - x, radius + 1);
        for (let r = r0; r < r1; r++) {
          let kernel_value = kernel[r + radius];
          value += source[indexS + r] * kernel_value;
          kernel_sum += kernel_value;
        }
        dest[indexD] = value / kernel_sum;
      }
    }
    return dest;
  }

  function radial_smooth(source) {
    const temp = radial_smooth_half(source, frameWidth, frameHeight);
    const dest = radial_smooth_half(temp, frameHeight, frameWidth);
    return dest;
  }

  function mip_scale_down(source, width, height) {
    const ww = Math.floor(width / 2);
    const hh = Math.floor(height / 2);
    const dest = new Float32Array(ww * hh);
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < ww; x++) {
        const index = y * 2 * width + x * 2;
        let sumValue = source[index];
        sumValue += source[index + 1]
        sumValue += source[index + width]
        sumValue += source[index + width + 1]
        dest[y * ww + x] = sumValue / 4;
      }
    }
    return dest;
  }

  let GMipScale1 = null;
  let GMipScaleX = null;
  let GMipScaleXX = null;

  let GMipCorrect1 = null;
  let GMipCorrectX = null;
  let GMipCorrectXX = null;



  function roll_stable_values() {
    if(GMipScale1 === null) {
        return;
    }
    GMipCorrect1 = GMipScale1;
    GMipCorrectX = GMipScaleX;
    GMipCorrectXX = GMipScaleXX;
    GMipScale1 = null;
    GMipScaleX = null;
    GMipScaleXX = null;


    GStable_correction_accumulator += Math.abs(GStable_correction);
    if(GStable_correction_accumulator > 100) {
        startCalibration();
        alert("Manual recalibration needed");

        GStable_correction_accumulator = 0;
    }
    GStable_correction = 0;
  }

  function accumulate_stable_temperature(source, width, height) {
    let wh = source.length;
    if(GMipScale1 === null) {
      console.log('create'+wh);
      GMipScale1 = new Float32Array(wh);
      GMipScaleX = new Float32Array(wh);
      GMipScaleXX = new Float32Array(wh);
      GMipCorrect1 = null;
      GMipCorrectX = null;
      GMipCorrectXX = null;
    }
    for(let i=0; i<wh; i++) {
      let value = source[i];
      if(value<0 || 10000<value) {
        console.log('superhot value '+value);
        continue;
      }
      GMipScale1[i] += 1;
      GMipScaleX[i] += value;
      GMipScaleXX[i] += value * value;
    }
  }

  function stable_mean(source) {
    let i0 = Math.floor(source.length/4);
    let i1 = source.length - i0;
    let sum = 0;
    let count = 0;
    for(let i = i0; i < i1; i++) {
        sum += source[i];
        count += 1;
    }
    return sum / count;
  }

  function correct_stable_temperature(source) {
    GStable_correction = 0;

    let mip_1 = GMipCorrect1;
    let mip_x = GMipCorrectX;
    let mip_xx = GMipCorrectXX;
    if (mip_1 === null) {
      mip_1 = GMipScale1;
      mip_x = GMipScaleX;
      mip_xx = GMipScaleXX;
    }

    if(mip_1 === null) {
      GStable_uncertainty = 0.7;
//      showLoadingSnow(0.5, "...FFC...", "(A)");
//      return false;
      return true;
    }

    let bucket_variation = []
    let wh = source.length;
    for(let index=0; index<wh; index++) {
      let value = source[index];

      let exp_1 = mip_1[index]
      if(exp_1 < 9 * 10) {
        continue;
      }
      let exp_x = mip_x[index] / exp_1;
      let exp_xx = mip_xx[index] / exp_1;
      let inner = Math.max(0, exp_xx - exp_x*exp_x);
      let std_dev = Math.sqrt(inner)
      let abs_err = Math.abs(exp_x - value)
      if((std_dev < 15) && (abs_err<150)) {
        bucket_variation.push(exp_x - value);
      }
    }
    if(bucket_variation.length < 20) {
//      showLoadingSnow(0.2, "...FFC...", "(B)");
//      console.log("unreliable...");
      GStable_uncertainty = 0.5
      GStable_correction = 0;
      return true;
    }

    bucket_variation = bucket_variation.sort()
    let stable_mean_bucket = stable_mean(bucket_variation);
    console.log(stable_mean_bucket);
    GStable_correction = stable_mean_bucket;
    GStable_uncertainty = 0.2
//    console.log('correct_stable_temperature:' + GStable_correction);
    return true;
  }

  function update_stable_temperature(source, width, height) {
    if(GTimeSinceFFC<4) {
//        console.log("stable ignore"+timeSinceFFC+"s");
//        return
    }
//    console.log('timeSinceFFC:'+timeSinceFFC.toFixed(0));
    while (width>16) {
      source = mip_scale_down(source, width, height);
      width = Math.floor(width / 2);
      height = Math.floor(height / 2);
    }

    if(GTimeSinceFFC > 120) {
      accumulate_stable_temperature(source)
    }else{
      roll_stable_values()
    }
    return correct_stable_temperature(source);
  }

  function show_stable_temperature() {
    if(GMipScale1 === null) {
      return;
    }
    let ww = 10;
    let hh = 7;
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < ww; x++) {
        const index = y * ww + x;
        let exp_x = GMipScaleX[index] / GMipScale1[index];
        let exp_xx = GMipScaleXX[index] / GMipScale1[index];
        let inner = Math.max(0, exp_xx - exp_x*exp_x);
        let std_dev = Math.sqrt(inner)
        let value = std_dev;
        overlayCtx.font = "30px Arial";
        overlayCtx.textAlign = "center";
        overlayCtx.fillStyle = "#A0FFA0";
        let cx = (x+0.5) * overlayCanvas.width / ww;
        let cy = (y+0.9) * overlayCanvas.width / ww;
        overlayCtx.fillText(value.toFixed(0), cx, cy);
      }
    }
  }

  const averageTempTracking = [];
  let initialTemp = 0;
  function processSnapshotRaw(rawData, metaData) {
    let source = rawData;
    if (true) {
      const saltPepperData = median_smooth(rawData);
      const smoothedData = radial_smooth(saltPepperData);
      source = smoothedData;
    }
    let usv = update_stable_temperature(source, frameWidth, frameHeight);
    if(!usv) {
      return;
    }

    const x0 = frameWidth / 5;
    const x1 = frameWidth - x0;
    const y0 = frameHeight / 5;
    const y1 = frameHeight - 10;

    let hotSpotX = 0;
    let hotSpotY = 0;

    let darkValue = 1 << 30;
    let hotValue = 0;
    for (let y = y0; y !== y1; y++) {
      for (let x = x0; x !== x1; x++) {
        let index = y * frameWidth + x;
        let current = source[index];
        if (darkValue > current) {
          darkValue = current;
        }
        if (hotValue < current) {
          hotValue = current;
          hotSpotX = x;
          hotSpotY = y;
        }
      }
    }

    if (false) {
        hotSpotX = frameWidth / 2;
        hotSpotY = frameHeight / 2;
        hotValue[hotSpotY * frameHeight + hotSpotX];
    }

    let raw_hot_value = hotValue;
    let device_sensitivity = 40;
    device_sensitivity = 0;
    GDevice_temperature = metaData["TempC"];
    let device_adder = GDevice_temperature * device_sensitivity;
    hotValue -= device_adder;

    hotValue += GStable_correction;

    let alpha = 0.3;
    if (GCurrent_hot_value > hotValue) {
      alpha = 0.9;
    }
    GCurrent_hot_value = GCurrent_hot_value * alpha + hotValue * (1 - alpha);

    let feverThreshold = 1 << 16;
    let checkThreshold = 1 << 16;

    if (Mode === Modes.CALIBRATE) {
      GCalibrate_snapshot_value = GCurrent_hot_value;
      GCalibrate_snapshot_uncertainty = estimatedUncertaintyForValue(GCurrent_hot_value, false);
      GCalibrate_snapshot_time = new Date().getTime()
      checkThreshold = hotValue - 20 + device_adder;
    }
    if (Mode === Modes.SCAN) {
      const temperature = estimatedTemperatureForValue(hotValue);
      let uncertainty = estimatedUncertaintyForValue(hotValue);
      uncertainty = Math.max(uncertainty, 0.1**GDisplay_precision);

      showTemperature(temperature, uncertainty);
      feverThreshold =
        (GThreshold_fever - GCalibrate_temperature_celsius) / slope +
        GCalibrate_snapshot_value +
        device_adder;
      checkThreshold =
        (GThreshold_check - GCalibrate_temperature_celsius) / slope +
        GCalibrate_snapshot_value +
        device_adder;
    }

    //    console.log("hotValue: "+hotValue+", deviceTemp"+metaData['TempC']);

    // TODO: Make the dynamic range between 18 and 42 degrees or so, so that we can
    //  reduce the flicker when we calculate the dynamic range per frame, and give
    //  the appearance of a more stable readout?
    const dynamicRange = (255 * 255) / (raw_hot_value - darkValue);
    const scaleData = source;
    let imgData = ctx.createImageData(frameWidth, frameHeight);

    let p = 0;
    for (const f32Val of scaleData) {
      let v = (f32Val - darkValue) * dynamicRange;
      v = Math.sqrt(Math.max(v, 0)) // gamma correct
      let r = v;
      let g = v;
      let b = v;
      if (feverThreshold < f32Val) {
        r = 255;
        g *= 0.5;
        b *= 0.5;
      } else if (checkThreshold < f32Val) {
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

    overlayCtx.clearRect(0, 0, nativeOverlayWidth, nativeOverlayHeight);

    clearOverlay();
    show_stable_temperature();

    if (!duringFFC) {
      showHotspot(hotSpotX, hotSpotY);
    }
  }

  function clearOverlay() {
    overlayCtx.clearRect(0, 0, nativeOverlayWidth, nativeOverlayHeight);
  }

  function showHotspot(x, y) {
    overlayCtx.beginPath();
    overlayCtx.arc(
      (x * nativeOverlayWidth) / canvasWidth,
      (y * nativeOverlayHeight) / frameHeight,
      30 * window.devicePixelRatio,
      0,
      2 * Math.PI,
      false
    );
    overlayCtx.lineWidth = 3 * window.devicePixelRatio;
    overlayCtx.strokeStyle = "#ff0000";
    overlayCtx.stroke();
  }

  // TODO: Click on the canvas to center the region where you'd like to evaluate temperature.
  // TODO: Take an average of a square near the top right/left and use it to track drift, have a rolling
  //  average.

  let duringFFC = false;
  async function fetchFrameDataAndTelemetry() {
    setTimeout(fetchFrameDataAndTelemetry, fetch_frame_delay);

    fetch_frame_delay = Math.min(5000, fetch_frame_delay * 1.3 + 100);

    try {
      const response = await fetch(`${CAMERA_RAW}?${new Date().getTime()}`, {
        method: "GET",
        headers: {
          Authorization: `Basic ${btoa("admin:feathers")}`
        }
      });
      const metaData = JSON.parse(response.headers.get("Telemetry"));
      const data = await response.arrayBuffer();
      if (data.byteLength > 13) {
        GTimeSinceFFC = (metaData.TimeOn - metaData.LastFFCTime) / (1000 * 1000 * 1000)

        const typedData = new Uint16Array(data);
        if (typedData.length === frameWidth * frameHeight) {
          processSnapshotRaw(typedData, metaData);
          scanButton.removeAttribute("disabled");
          fetch_frame_delay = 1000 / 8.7;
        }

        const ffcDelay = 4 - GTimeSinceFFC;
        if (metaData.FFCState !== "complete" || ffcDelay > 0) {
          scanButton.setAttribute("disabled", "disabled");
          duringFFC = true;
          const alpha = Math.min(ffcDelay * 0.1, 0.75);
          let delayS = ''
          if (ffcDelay >= 0) {
            delayS = ffcDelay.toFixed(0).toString();
          }

          setOverlayMessages("...FFC...", delayS);
          showLoadingSnow(alpha);
          showTemperature(20, 100);
        } else {
          if (duringFFC) {
            // FFC ended
            setOverlayMessages();
            duringFFC = false;
          }
        }
      } else {
        setOverlayMessages("Loading");
        showLoadingSnow();
      }
    } catch (err) {
      console.log(err)
      setOverlayMessages("Error");
      showLoadingSnow(0.5);
    }
  }

  function openNav(text) {
    calibrationOverlay.classList.add("show");
    overlayMessage.innerHTML = text;
  }

  function closeNav() {
    calibrationOverlay.classList.remove("show");
  }

  function setTitle(text) {
    titleDiv.innerText = text;
  }

  function startCalibration(message) {
    Mode = Modes.CALIBRATE;
    setOverlayMessages();
    settingsDiv.classList.add("show-calibration");
    setTitle(message || "Calibrate");
    GCalibrate_uncertainty = GStable_uncertainty;
  }

  function startScan() {
    setOverlayMessages("Calibration saved");
    setTimeout(setOverlayMessages, 500);
    Mode = Modes.SCAN;
    settingsDiv.classList.remove("show-calibration");
    setTitle("Scanning...");
  }

  setTimeout(function() {
    startCalibration();
  }, 500);
  fetchFrameDataAndTelemetry();
};

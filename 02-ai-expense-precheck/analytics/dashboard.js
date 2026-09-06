(function () {
  "use strict";

  const periods = {
    7: {
      nsm: "24",
      delta: "较上周 +20%",
      caption: "近 7 天 · 演示目标 40",
      started: "33",
      completion: "72.7%",
      closure: "68.4%",
      duration: "4分12秒",
      repeat: "62.5%",
      values: [12, 14, 15, 18, 17, 20, 24]
    },
    28: {
      nsm: "79",
      delta: "较前 28 天 +12.9%",
      caption: "近 28 天 · 演示目标 160",
      started: "108",
      completion: "73.1%",
      closure: "70.5%",
      duration: "4分24秒",
      repeat: "59.2%",
      values: [48, 52, 61, 58, 70, 73, 79]
    }
  };

  const positions = [52, 165, 278, 391, 504, 617, 730];

  function chartCoordinates(values) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = Math.max(max - min, 1);
    return values.map((value, index) => ({
      x: positions[index],
      y: Math.round(174 - ((value - min) / spread) * 72)
    }));
  }

  function renderPeriod(periodKey) {
    const data = periods[periodKey];
    if (!data) return;
    document.getElementById("nsm-value").textContent = data.nsm;
    document.getElementById("nsm-delta").textContent = data.delta;
    document.getElementById("trend-caption").textContent = data.caption;
    document.getElementById("metric-started").textContent = data.started;
    document.getElementById("metric-completion").textContent = data.completion;
    document.getElementById("metric-closure").textContent = data.closure;
    document.getElementById("metric-duration").textContent = data.duration;
    document.getElementById("metric-repeat").textContent = data.repeat;

    const points = chartCoordinates(data.values);
    const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
    const areaPath = `${linePath} L730,196 L52,196 Z`;
    document.getElementById("trend-line").setAttribute("d", linePath);
    document.getElementById("trend-area").setAttribute("d", areaPath);
    document.getElementById("trend-points").innerHTML = points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4"></circle>`).join("");
    document.getElementById("trend-desc").textContent = `合成演示数据，当前值 ${data.nsm}。`;
  }

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      document.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab;
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.getElementById("period-select").addEventListener("change", (event) => {
    renderPeriod(event.target.value);
  });

  renderPeriod("7");
})();

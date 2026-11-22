(function () {
  "use strict";

  const viewRoot = document.getElementById("app-view");
  const overlayRoot = document.getElementById("overlay-root");
  const toastRoot = document.getElementById("toast-root");
  const appRoot = document.getElementById("expense-app");
  const expenseCategories = ["办公采购", "差旅"];
  const attachmentTypes = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
  const dateWindowDays = 30;

  const FIELD_META = {
    merchant: { label: "商户名称", source: "发票第 1 页" },
    amount: { label: "票据金额", source: "发票第 1 页" },
    invoiceDate: { label: "开票日期", source: "发票第 1 页" },
    invoiceNumber: { label: "发票号码", source: "发票第 1 页" },
    category: { label: "费用类别", source: "申请信息" },
    excessExplanation: { label: "超额说明材料", source: "补充材料 v2" }
  };

  const CASE_DEFINITIONS = {
    normal: {
      id: "BX-0010",
      subject: "员工-031",
      category: "办公采购",
      claimedAmount: 142.5,
      documentAmount: 142.5,
      documentName: "demo-office-01.pdf",
      documentMerchant: "示例办公供应",
      documentDate: "2026-08-15",
      submissionDate: "2026-08-17",
      documentInvoiceNumber: "DEMO-001010",
      description: "材料齐全，字段清晰，适用规则全部通过",
      initialStatus: "review",
      version: 1,
      fields: {
        merchant: { value: "示例办公供应", confidence: "high", status: "machine_extracted" },
        amount: { value: 142.5, confidence: "high", status: "machine_extracted" },
        invoiceDate: { value: "2026-08-15", confidence: "high", status: "machine_extracted" },
        invoiceNumber: { value: "DEMO-001010", confidence: "high", status: "machine_extracted" },
        category: { value: "办公采购", confidence: "human", status: "human_confirmed" }
      },
      hasExcessExplanation: false,
      events: [
        event("CASE_CREATED", "系统", "创建合成案例 BX-0010", "材料 v1 · 数据分类 synthetic", "09:18"),
        event("DOCUMENT_PROCESSED", "文档理解", "生成字段候选与证据", "5 个字段 · 无阻断字段", "09:19")
      ]
    },
    low: {
      id: "BX-0007",
      subject: "员工-012",
      category: "差旅",
      claimedAmount: 268,
      documentAmount: 268,
      documentName: "demo-invoice-01.pdf",
      documentMerchant: "示例商旅服务",
      documentDate: "2026-08-14",
      submissionDate: "2026-08-17",
      documentInvoiceNumber: "DEMO-008271",
      description: "金额识别存在疑问，需要查看原文并修正",
      initialStatus: "review",
      version: 1,
      fields: {
        merchant: { value: "示例商旅服务", confidence: "high", status: "machine_extracted" },
        amount: { value: 286, confidence: "low", status: "machine_extracted", blocking: true },
        invoiceDate: { value: "2026-08-14", confidence: "high", status: "machine_extracted" },
        invoiceNumber: { value: "DEMO-008271", confidence: "medium", status: "machine_extracted" },
        category: { value: "差旅", confidence: "human", status: "human_confirmed" }
      },
      hasExcessExplanation: false,
      events: [
        event("CASE_CREATED", "系统", "创建合成案例 BX-0007", "材料 v1 · 数据分类 synthetic", "10:09"),
        event("DOCUMENT_PROCESSED", "文档理解", "生成字段候选与证据", "金额字段低置信 · 发票号码中置信", "10:10")
      ]
    },
    exception: {
      id: "BX-0011",
      subject: "员工-018",
      category: "差旅",
      claimedAmount: 268,
      documentAmount: 268,
      documentName: "demo-travel-02.pdf",
      documentMerchant: "示例商旅服务",
      documentDate: "2026-08-12",
      submissionDate: "2026-08-17",
      documentInvoiceNumber: "DEMO-001122",
      description: "字段已确认，但存在明确额度异常",
      initialStatus: "review",
      version: 1,
      fields: {
        merchant: { value: "示例商旅服务", confidence: "high", status: "human_confirmed" },
        amount: { value: 268, confidence: "human", status: "human_confirmed" },
        invoiceDate: { value: "2026-08-12", confidence: "high", status: "human_confirmed" },
        invoiceNumber: { value: "DEMO-001122", confidence: "high", status: "human_confirmed" },
        category: { value: "差旅", confidence: "human", status: "human_confirmed" }
      },
      hasExcessExplanation: false,
      events: [
        event("CASE_CREATED", "系统", "创建合成案例 BX-0011", "材料 v1 · 数据分类 synthetic", "09:42"),
        event("FIELDS_CONFIRMED", "审核员", "字段已确认", "5 个关键字段可用于规则检查", "09:44")
      ]
    },
    supplement: {
      id: "BX-0012",
      subject: "员工-024",
      category: "差旅",
      claimedAmount: 268,
      documentAmount: 268,
      documentName: "demo-travel-03.pdf",
      documentMerchant: "示例商旅服务",
      documentDate: "2026-08-11",
      submissionDate: "2026-08-17",
      documentInvoiceNumber: "DEMO-001203",
      description: "上次要求补充超额说明，等待新材料版本",
      initialStatus: "needs_info",
      version: 1,
      fields: {
        merchant: { value: "示例商旅服务", confidence: "high", status: "human_confirmed" },
        amount: { value: 268, confidence: "high", status: "human_confirmed" },
        invoiceDate: { value: "2026-08-11", confidence: "high", status: "human_confirmed" },
        invoiceNumber: { value: "DEMO-001203", confidence: "high", status: "human_confirmed" },
        category: { value: "差旅", confidence: "human", status: "human_confirmed" }
      },
      hasExcessExplanation: false,
      events: [
        event("CASE_CREATED", "系统", "创建合成案例 BX-0012", "材料 v1 · 数据分类 synthetic", "08:51"),
        event("PRECHECK_RUN", "规则引擎", "完成规则检查", "1 项异常 · 1 项未知 · run-0012", "08:53"),
        event("DECISION_SUBMITTED", "审核员", "人工决定：要求补充材料", "原因：需要补充超额说明", "08:55")
      ]
    }
  };

  let state = createInitialState();
  let toastTimer = null;

  function event(type, source, summary, detail, at) {
    return {
      id: `${type}-${at}-${Math.random().toString(16).slice(2, 7)}`,
      type,
      source,
      summary,
      detail,
      at
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createInitialState() {
    const cases = {};
    Object.keys(CASE_DEFINITIONS).forEach((key) => {
      cases[key] = clone(CASE_DEFINITIONS[key]);
      cases[key].status = cases[key].initialStatus || "review";
    });
    return {
      cases,
      view: "home",
      selectedCaseId: null,
      selectedRuleId: null,
      selectedPreset: "normal",
      nextImportId: 1,
      editingField: null,
      focusField: null,
      decision: null,
      submittedDecision: null,
      processing: null,
      processingToken: 0,
      fileFailure: false
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatMoney(value) {
    if (value === null || value === undefined || value === "") return "—";
    return `¥${Number(value).toFixed(2)}`;
  }

  function isoDateTime(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : NaN;
  }

  function currentCase() {
    if (!state.selectedCaseId) return null;
    return Object.values(state.cases).find((item) => item.id === state.selectedCaseId) || null;
  }

  function caseByKey(key) {
    return state.cases[key] || null;
  }

  function keyForCase(caseId) {
    return Object.keys(state.cases).find((key) => state.cases[key].id === caseId) || null;
  }

  function isMoney(value) {
    return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Math.round(Number(value) * 100));
  }

  function nextEventTime(caseItem) {
    const last = caseItem.events[caseItem.events.length - 1];
    const parts = String(last?.at || "10:00").split(":");
    const minutes = Number(parts[1] || 0) + 1;
    return `${parts[0]}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function addEvent(caseItem, type, source, summary, detail) {
    caseItem.events.push(event(type, source, summary, detail, nextEventTime(caseItem)));
  }

  function fieldEntries(caseItem) {
    return Object.entries(caseItem.fields).map(([key, field]) => ({ key, ...FIELD_META[key], ...field }));
  }

  function hasBlockingFields(caseItem) {
    return fieldEntries(caseItem).some((field) => field.blocking && !["human_confirmed", "human_corrected", "unknown"].includes(field.status));
  }

  function hasUnknown(caseItem) {
    return Array.isArray(caseItem.rules) && caseItem.rules.some((rule) => rule.status === "UNKNOWN");
  }

  function hasException(caseItem) {
    return Array.isArray(caseItem.rules) && caseItem.rules.some((rule) => rule.status === "EXCEPTION");
  }

  function statusInfo(caseItem) {
    if (caseItem.status === "needs_info") return { label: "等待补充材料", className: "attention", hint: "可从时间线模拟补充" };
    if (caseItem.status === "returned") return { label: "已退回", className: "exception", hint: "首版为终态" };
    if (caseItem.status === "completed") return { label: "预审已完成", className: "pass", hint: "人工决定已提交" };
    if (caseItem.rulesStale) return { label: "结果已过期", className: "attention", hint: "需要重新检查" };
    if (hasBlockingFields(caseItem)) return { label: "字段待确认", className: "attention", hint: "存在阻断字段" };
    if (!caseItem.rules) return { label: "待运行规则", className: "attention", hint: "等待预审检查" };
    if (hasUnknown(caseItem)) return { label: "需人工复核", className: "unknown", hint: "存在未知结果" };
    if (hasException(caseItem)) return { label: "存在异常", className: "exception", hint: "需要人工处理" };
    return { label: "待人工决定", className: "attention", hint: "规则检查已完成" };
  }

  function confidenceLabel(field) {
    if (field.status === "human_confirmed" || field.status === "human_corrected") return { text: "人工确认", className: "human" };
    if (field.status === "unknown") return { text: "UNKNOWN", className: "low" };
    if (field.status === "imported") return { text: "待核对", className: "medium" };
    if (field.confidence === "low") return { text: "低置信 · 阻断", className: "low" };
    if (field.confidence === "medium") return { text: "中置信 · 建议确认", className: "medium" };
    return { text: "高置信", className: "high" };
  }

  function invalidateRun(caseItem) {
    if (caseItem.rules) caseItem.rulesStale = true;
    caseItem.status = "review";
  }

  function calculateRules(caseItem) {
    const fields = caseItem.fields;
    const amount = fields.amount.status === "unknown" ? null : Number(fields.amount.value);
    const requiredFields = fieldEntries(caseItem).filter((field) => ["merchant", "amount", "invoiceDate", "invoiceNumber", "category"].includes(field.key));
    const requiredUnknown = requiredFields.some((field) => field.status === "unknown" || field.value === null || field.value === undefined || field.value === "");
    const amountUnknown = amount === null || Number.isNaN(amount);
    const dateGap = (isoDateTime(caseItem.submissionDate) - isoDateTime(fields.invoiceDate.value)) / 86400000;
    const dateStatus = !Number.isFinite(dateGap) ? "UNKNOWN" : (dateGap < 0 || dateGap > dateWindowDays ? "EXCEPTION" : "PASS");
    const dateReason = dateStatus === "UNKNOWN" ? "缺少可确认的开票日期或提交日期。" :
      `开票日期 ${fields.invoiceDate.value}，提交日期 ${caseItem.submissionDate}。${dateStatus === "PASS" ? "在" : "超出"}模拟提交窗口。`;
    const category = fields.category.value;
    const isTravel = category === "差旅";
    const needsExplanation = isTravel && !amountUnknown && amount > 200;
    const explanationStatus = isTravel && (amountUnknown || (needsExplanation && !caseItem.hasExcessExplanation)) ? "UNKNOWN" : "PASS";
    const explanationReason = isTravel && amountUnknown ? "金额无法确认，暂时无法判断是否需要超额说明。" :
      (needsExplanation ? (caseItem.hasExcessExplanation ? "已收到模拟超额说明材料。" : "未检测到可确认的超额说明，无法判断是否适用例外。") : "当前案例不需要超额说明。");
    const rules = [
      {
        id: "required_fields",
        name: "必填字段完整性",
        status: requiredUnknown ? "UNKNOWN" : "PASS",
        reason: requiredUnknown ? "至少一个关键字段无法确认。" : "金额、日期、商户、票号和费用类别均有可用值。",
        evidence: requiredUnknown ? "字段核对区标记了未知字段" : "字段与对应文档证据",
        actionItems: requiredUnknown ? ["补充或确认缺失字段"] : []
      },
      {
        id: "date_window",
        name: "票据日期范围",
        status: dateStatus,
        reason: dateReason,
        evidence: "开票日期与提交日期",
        evidenceField: "invoiceDate",
        actionItems: dateStatus === "PASS" ? [] : ["核对开票日期与提交日期"]
      },
      {
        id: "amount_consistency",
        name: "申请与票据金额一致",
        status: amountUnknown ? "UNKNOWN" : (Math.abs(amount - caseItem.claimedAmount) < 0.01 ? "PASS" : "EXCEPTION"),
        reason: amountUnknown ? "票据金额无法确认。" : (Math.abs(amount - caseItem.claimedAmount) < 0.01 ? `申请金额与票据合计均为 ${formatMoney(amount)}。` : `申请金额 ${formatMoney(caseItem.claimedAmount)} 与票据金额 ${formatMoney(amount)} 不一致。`),
        evidence: "申请信息 + 发票金额字段",
        actual: amount,
        expected: caseItem.claimedAmount,
        actionItems: amountUnknown ? ["确认票据金额"] : ["核对申请金额与票据金额"]
      },
      {
        id: "travel_limit",
        name: "模拟差旅单笔额度",
        status: amountUnknown ? "UNKNOWN" : (needsExplanation ? "EXCEPTION" : "PASS"),
        reason: amountUnknown ? "无法判断是否超过模拟额度。" : (needsExplanation ? `实际 ${formatMoney(amount)}；模拟额度 ≤ ¥200.00；超出 ${formatMoney(amount - 200)}。` : (isTravel ? "金额在当前模拟额度内。" : "此费用类别无需检查差旅额度。")),
        evidence: "发票金额字段 + policy_demo_travel / 1.2",
        actual: amount,
        expected: 200,
        actionItems: amountUnknown ? ["确认金额或补充清晰票据"] : (needsExplanation ? ["补充超额原因说明", "提交负责人确认记录"] : [])
      },
      {
        id: "excess_explanation",
        name: "差旅说明材料",
        status: explanationStatus,
        reason: explanationReason,
        evidence: caseItem.hasExcessExplanation ? "demo-excess-note-v2.pdf" : "材料列表中缺少超额说明",
        evidenceField: caseItem.hasExcessExplanation ? "excessExplanation" : "materials",
        actionItems: explanationStatus === "PASS" ? [] : [amountUnknown ? "确认票据金额" : "补充超额原因说明"]
      }
    ];
    return rules;
  }

  function ruleStatusMeta(status) {
    if (status === "UNKNOWN") return { className: "unknown", marker: "?", label: "UNKNOWN", caption: "需人工判断" };
    if (status === "EXCEPTION") return { className: "exception", marker: "!", label: "EXCEPTION", caption: "明确异常" };
    return { className: "pass", marker: "✓", label: "PASS", caption: "规则通过" };
  }

  function sortedRules(caseItem) {
    const rank = { UNKNOWN: 0, EXCEPTION: 1, PASS: 2 };
    return (caseItem.rules || []).slice().sort((a, b) => rank[a.status] - rank[b.status]);
  }

  function ruleCounts(caseItem) {
    const rules = caseItem.rules || [];
    return {
      unknown: rules.filter((rule) => rule.status === "UNKNOWN").length,
      exception: rules.filter((rule) => rule.status === "EXCEPTION").length,
      pass: rules.filter((rule) => rule.status === "PASS").length
    };
  }

  function setView(view, focusField = null) {
    const importForm = viewRoot.querySelector("[data-import-form]");
    if (importForm) clearImportPreview(importForm);
    state.view = view;
    state.selectedRuleId = null;
    state.editingField = null;
    state.focusField = focusField;
    overlayRoot.innerHTML = "";
    render();
    if (!focusField) window.requestAnimationFrame(() => viewRoot.focus({ preventScroll: true }));
  }

  function showToast(message, tone) {
    window.clearTimeout(toastTimer);
    toastRoot.innerHTML = `<div class="toast ${tone || ""}">${escapeHtml(message)}</div>`;
    toastTimer = window.setTimeout(() => {
      toastRoot.innerHTML = "";
    }, 3000);
  }

  function beginProcessing(kind, caseItem) {
    const token = ++state.processingToken;
    state.processing = { kind, caseId: caseItem.id, step: 1 };
    state.view = "processing";
    overlayRoot.innerHTML = "";
    render();
    window.setTimeout(() => {
      if (token !== state.processingToken) return;
      completeProcessing(kind, caseItem);
    }, kind === "rules" ? 620 : 720);
  }

  function completeProcessing(kind, caseItem) {
    state.processing = null;
    if (kind === "create") {
      caseItem.status = "review";
      caseItem.rules = null;
      caseItem.rulesStale = false;
      addEvent(caseItem, "DOCUMENT_PROCESSED", "文档理解", "完成模拟材料处理", `${Object.keys(caseItem.fields).length} 个字段候选已生成`);
      state.view = "review";
    } else if (kind === "rules") {
      caseItem.rules = calculateRules(caseItem);
      caseItem.rulesStale = false;
      caseItem.status = "checked";
      caseItem.lastRunId = `run-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      addEvent(caseItem, "PRECHECK_RUN", "规则引擎", "完成规则检查", `${ruleCounts(caseItem).unknown} 项未知 · ${ruleCounts(caseItem).exception} 项异常 · ${caseItem.lastRunId}`);
      state.view = "results";
    } else if (kind === "supplement") {
      caseItem.version += 1;
      caseItem.hasExcessExplanation = true;
      caseItem.status = "review";
      caseItem.rulesStale = true;
      caseItem.fields.excessExplanation = { value: "已收到", confidence: "human", status: "human_confirmed" };
      addEvent(caseItem, "MATERIAL_VERSION_CREATED", "审核员（模拟）", `保存补充材料 v${caseItem.version}`, "超额说明材料已加入案例；员工端和通知不在本 Demo 内");
      state.view = "review";
    }
    render();
  }

  function render() {
    updateTopbar();
    if (state.view === "home") viewRoot.innerHTML = renderHome();
    if (state.view === "create") viewRoot.innerHTML = renderCreate();
    if (state.view === "import") viewRoot.innerHTML = renderImport();
    if (state.view === "processing") viewRoot.innerHTML = renderProcessing();
    if (state.view === "review") viewRoot.innerHTML = renderReview();
    if (state.view === "results") viewRoot.innerHTML = renderResults();
    if (state.view === "timeline") viewRoot.innerHTML = renderTimeline();
    if (state.view === "policy") viewRoot.innerHTML = renderPolicy();
    if (state.view !== "processing" && state.processing) state.processing = null;
  }

  function locateEvidence(fieldKey) {
    setView("review", fieldKey);
    const evidence = viewRoot.querySelector(`[data-evidence-field="${fieldKey}"]`);
    evidence?.focus({ preventScroll: true });
    evidence?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function updateTopbar() {
    const homeActive = ["home", "create", "import"].includes(state.view);
    document.querySelectorAll(".top-nav-item").forEach((button, index) => {
      button.classList.toggle("is-active", index === 0 ? homeActive : state.view === "policy");
    });
  }

  function renderHome() {
    const rows = Object.values(state.cases).map((caseItem) => {
      const info = statusInfo(caseItem);
      const action = caseItem.status === "completed" || caseItem.status === "returned" ? "查看记录" : (caseItem.status === "needs_info" ? "补充材料" : "继续处理");
      return `<div class="case-list-row">
        <div class="case-primary"><strong>${escapeHtml(caseItem.id)}</strong><span class="case-secondary">版本 ${caseItem.version}</span></div>
        <span>${escapeHtml(caseItem.subject)}</span>
        <span>${escapeHtml(caseItem.category)}</span>
        <strong>${formatMoney(caseItem.claimedAmount)}</strong>
        <div class="case-status"><span class="status ${info.className}">${escapeHtml(info.label)}</span><small>${escapeHtml(info.hint)}</small></div>
        <div class="case-list-action"><button class="action secondary" type="button" data-action="select-case" data-case-id="${escapeHtml(caseItem.id)}">${action}</button></div>
      </div>`;
    }).join("");

    return `<div class="prototype-content">
      <div class="view-header">
        <div><p class="view-kicker">费用预审</p><h1>待处理案例</h1><p>选择一笔案例继续核对，或创建一组新的合成材料。</p></div>
        <button class="action primary" type="button" data-action="go-create">新建案例</button>
      </div>
      <div class="prototype-note"><strong>演示材料</strong><span>可体验预置案例，或在浏览器中导入自己的测试材料。</span></div>
      <div class="home-actions"><button class="action secondary" type="button" data-action="show-policy">查看当前规则说明</button></div>
      <section class="case-list-shell" aria-label="案例列表">
        <div class="case-list-head"><span>案例</span><span>提交人</span><span>费用类型</span><span>申请金额</span><span>当前状态</span><span>操作</span></div>
        ${rows}
      </section>
      <div class="flow-callout" aria-label="演示路径">
        <div><strong>正常通过</strong><span>字段 → 规则 → 人工通过</span></div>
        <div><strong>低置信修正</strong><span>证据 → 修正 → 重算</span></div>
        <div><strong>明确异常</strong><span>依据 → 行动清单 → 退回</span></div>
        <div><strong>补充重审</strong><span>新版本 → 差异 → 再检查</span></div>
      </div>
      <div class="home-footer"><span>原型状态：中保真交互验证 · 无真实业务结果</span><span>规则集：policy_demo_travel v1.2</span></div>
    </div>`;
  }

  function renderCreate() {
    const options = [
      ["normal", "正常案例", "材料齐全，字段清晰，适用规则全部通过", "流程 F-A"],
      ["low", "低置信案例", "金额存在识别疑问，需要查看原文并修正", "流程 F-B"],
      ["exception", "明确异常案例", "字段已确认，但模拟额度超出", "流程 F-C"]
    ];
    const optionMarkup = options.map(([key, title, description, flow]) => `<label class="preset-option ${state.selectedPreset === key ? "is-selected" : ""}">
      <input type="radio" name="preset" value="${key}" data-preset ${state.selectedPreset === key ? "checked" : ""}>
      <span class="preset-copy"><strong>${title}</strong><span>${description}</span></span>
      <span class="preset-meta">${flow}</span>
    </label>`).join("");
    const failure = state.fileFailure ? `<div class="prototype-note warning"><strong>材料处理失败</strong><span>demo-broken-file.pdf 无法读取。请选择替换材料或重试；案例不会进入字段核对。</span><button class="action secondary" type="button" data-action="retry-file">重试</button></div>` : "";
    return `<div class="prototype-content create-shell">
      <div class="prototype-breadcrumb"><button class="text-button" type="button" data-action="go-home">案例入口</button><span>/</span><span>创建案例</span></div>
      <div class="view-header"><div><p class="view-kicker">步骤 1 / 2</p><h1>选择一组报销材料</h1><p>预置案例用于验证不同风险状态，不代表真实业务结果。</p></div></div>
      <div class="create-upload"><div><strong>有自己的报销材料</strong><span>导入 JSON，或选择 PDF、JPG、PNG 后填写字段。</span></div><button class="action primary" type="button" data-action="go-import">导入材料</button></div>
      ${failure}
      <fieldset class="preset-list"><legend>预置合成案例</legend>${optionMarkup}</fieldset>
      <div class="create-upload"><div><strong>演示材料处理异常</strong></div><button class="action secondary" type="button" data-action="show-file-failure">模拟失败状态</button></div>
      <div class="view-actions"><button class="action secondary" type="button" data-action="go-home">取消</button><button class="action primary" type="button" data-action="start-preset">开始预审</button></div>
    </div>`;
  }

  function renderImport() {
    return `<div class="prototype-content create-shell">
      <div class="prototype-breadcrumb"><button class="text-button" type="button" data-action="go-home">案例入口</button><span>/</span><button class="text-button" type="button" data-action="go-create">新建案例</button></div>
      <div class="view-header"><div><h1>导入报销材料</h1><p>JSON 直接读入字段。PDF 和图片可预览，票据字段由你填写。</p></div></div>
      <div class="prototype-note"><strong>仅在当前页面处理</strong><span>文件保留在浏览器当前会话。刷新页面或重置演示后会清空。</span></div>
      <form class="import-form" data-import-form>
        <label>选择材料（最多 10 MB）<input type="file" name="material" accept=".json,.pdf,.png,.jpg,.jpeg" required></label>
        <div data-import-preview></div>
        <fieldset data-manual-fields hidden>
          <legend>按申请和原件录入字段</legend>
          <div class="import-grid">
            <label>提交人<input type="text" name="subject" maxlength="100"></label>
            <label>费用类别<select name="category">${expenseCategories.map((item) => `<option>${item}</option>`).join("")}</select></label>
            <label>申请金额（元）<input type="number" name="claimedAmount" min="0.01" step="0.01"></label>
            <label>票据金额（元）<input type="number" name="invoiceAmount" min="0.01" step="0.01"></label>
            <label>开票日期<input type="date" name="invoiceDate"></label>
            <label>提交日期<input type="date" name="submissionDate"></label>
            <label>商户名称<input type="text" name="merchant" maxlength="100"></label>
            <label>发票号码<input type="text" name="invoiceNumber" maxlength="100"></label>
          </div>
        </fieldset>
        <p class="import-error" data-import-error role="alert"></p>
        <div class="view-actions"><button class="action secondary" type="button" data-action="go-create">返回</button><button class="action primary" type="submit" disabled>导入并开始预审</button></div>
      </form>
    </div>`;
  }

  function fileExtension(file) {
    return file?.name.split(".").pop().toLowerCase();
  }

  function clearImportPreview(form) {
    if (form.dataset.previewUrl) URL.revokeObjectURL(form.dataset.previewUrl);
    delete form.dataset.previewUrl;
  }

  async function loadAttachment(file, type) {
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const signatures = {
      "application/pdf": [37, 80, 68, 70, 45],
      "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
      "image/jpeg": [255, 216, 255]
    };
    if (!signatures[type].every((byte, index) => header[index] === byte)) {
      throw new Error("文件内容与扩展名不匹配，请选择可读取的 PDF、JPG 或 PNG。");
    }
    return URL.createObjectURL(file.slice(0, file.size, type));
  }

  function renderAttachment(url, type, fileName) {
    const source = escapeHtml(url);
    const title = escapeHtml(fileName);
    const preview = type === "application/pdf"
      ? `<object class="attachment-pdf" data="${source}" type="application/pdf" aria-label="${title}"></object>`
      : `<img class="attachment-image" src="${source}" alt="${title}">`;
    return `<div class="attachment-preview">${preview}<a class="text-button" href="${source}" target="_blank" rel="noopener">在新标签页查看原件</a></div>`;
  }

  function validateImport(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("JSON 需包含一笔报销的字段。");
    const values = {};
    const textFields = { subject: "提交人", category: "费用类别", merchant: "商户名称", invoiceNumber: "发票号码" };
    for (const [key, label] of Object.entries(textFields)) {
      const value = typeof raw[key] === "string" ? raw[key].trim() : "";
      if (!value || value.length > 100) throw new Error(`请填写有效的${label}（${key}）。`);
      values[key] = value;
    }
    if (!expenseCategories.includes(values.category)) throw new Error("费用类别请选择办公采购或差旅。");
    for (const [key, label] of [["claimedAmount", "申请金额"], ["invoiceAmount", "票据金额"]]) {
      const value = String(raw[key] ?? "").trim();
      if (!isMoney(value)) {
        throw new Error(`${label}（${key}）须为大于 0 的人民币金额，最多两位小数。`);
      }
      values[key] = Number(value);
    }
    for (const [key, label] of [["invoiceDate", "开票日期"], ["submissionDate", "提交日期"]]) {
      if (!Number.isFinite(isoDateTime(raw[key]))) throw new Error(`请填写有效的${label}（${key}，格式 YYYY-MM-DD）。`);
      values[key] = raw[key];
    }
    return values;
  }

  async function handleImportFile(input) {
    const form = input.form;
    const file = input.files[0];
    const extension = fileExtension(file);
    const type = Object.hasOwn(attachmentTypes, extension) ? attachmentTypes[extension] : null;
    const error = form.querySelector("[data-import-error]");
    const preview = form.querySelector("[data-import-preview]");
    const submit = form.querySelector('button[type="submit"]');
    clearImportPreview(form);
    preview.innerHTML = "";
    error.textContent = "";
    form.querySelector("[data-manual-fields]").hidden = !type;
    submit.disabled = true;
    if (!file) return;
    if ((!type && extension !== "json") || file.size > 10 * 1024 * 1024) {
      error.textContent = "请选择 10 MB 以内的 JSON、PDF、JPG 或 PNG。";
      return;
    }
    if (!type) {
      submit.disabled = false;
      return;
    }
    try {
      const url = await loadAttachment(file, type);
      if (!form.isConnected || input.files[0] !== file) {
        URL.revokeObjectURL(url);
        return;
      }
      form.dataset.previewUrl = url;
      preview.innerHTML = renderAttachment(url, type, file.name);
      submit.disabled = false;
    } catch (problem) {
      if (form.isConnected && input.files[0] === file) error.textContent = problem.message;
    }
  }

  async function importCase(submitEvent) {
    const form = submitEvent.target;
    if (!form.matches("[data-import-form]")) return;
    submitEvent.preventDefault();
    const file = form.elements.material.files[0];
    if (!file || file.size > 10 * 1024 * 1024) return;
    const isJson = fileExtension(file) === "json";
    if (!isJson && !form.dataset.previewUrl) return;
    const submit = form.querySelector('button[type="submit"]');
    const error = form.querySelector("[data-import-error]");
    error.textContent = "";
    submit.disabled = true;
    try {
      let raw;
      if (isJson) {
        try {
          raw = JSON.parse(await file.text());
        } catch {
          throw new Error("JSON 文件无法读取，请检查格式后重试。");
        }
      } else {
        raw = Object.fromEntries(new FormData(form));
      }
      if (!form.isConnected || form.elements.material.files[0] !== file) return;
      const values = validateImport(raw);
      const id = `IMP-${String(state.nextImportId++).padStart(4, "0")}`;
      const candidate = (value, source) => ({ value, source, confidence: "review", status: "imported" });
      const fieldSource = isJson ? "导入的 JSON" : "按附件录入";
      const caseItem = {
        id, subject: values.subject, category: values.category, claimedAmount: values.claimedAmount,
        documentAmount: values.invoiceAmount, documentName: file.name, documentMerchant: values.merchant,
        documentDate: values.invoiceDate, documentInvoiceNumber: values.invoiceNumber, submissionDate: values.submissionDate,
        importKind: isJson ? "json" : "attachment", attachmentUrl: form.dataset.previewUrl,
        attachmentType: attachmentTypes[fileExtension(file)],
        version: 1, status: "review", hasExcessExplanation: false,
        fields: {
          merchant: candidate(values.merchant, fieldSource),
          amount: candidate(values.invoiceAmount, fieldSource),
          invoiceDate: candidate(values.invoiceDate, fieldSource),
          invoiceNumber: candidate(values.invoiceNumber, fieldSource),
          category: candidate(values.category, isJson ? fieldSource : "申请信息")
        },
        events: [event("CASE_CREATED", "审核员", `导入案例 ${id}`, `材料 v1 · ${file.name}`, new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }))]
      };
      delete form.dataset.previewUrl;
      state.cases[id] = caseItem;
      beginCase(caseItem);
    } catch (problem) {
      error.textContent = problem.message;
      submit.disabled = false;
    }
  }

  function renderProcessing() {
    const processing = state.processing || { kind: "create" };
    const title = processing.kind === "rules" ? "运行模拟规则" : (processing.kind === "supplement" ? "处理补充材料" : "处理案例材料");
    const steps = processing.kind === "rules"
      ? ["读取已确认事实快照", "执行 policy_demo_travel v1.2", "生成三态结果与证据说明"]
      : ["校验文件格式与数据边界", "提取字段并绑定证据", "准备人工核对工作台"];
    return `<div class="prototype-content prototype-processing"><div class="processing-inner">
      <p class="view-kicker">模拟处理</p><h1>${title}</h1><p>当前只展示交互状态；没有调用真实 OCR、模型或财务接口。</p>
      <div class="processing-track">${steps.map((step, index) => `<div class="processing-step ${index === 1 ? "is-active" : index === 0 ? "is-done" : ""}"><span class="step-mark">${index < 1 ? "✓" : index + 1}</span><span>${step}</span></div>`).join("")}</div>
      <p class="processing-footnote">处理完成后将回到当前案例，不自动提交任何审批决定。</p>
    </div></div>`;
  }

  function renderCaseContext(caseItem) {
    const info = statusInfo(caseItem);
    return `<div class="case-context prototype-case-context">
      <button class="context-action" type="button" data-action="go-home" aria-label="返回案例入口">&larr;</button>
      <div><strong>${escapeHtml(caseItem.id)}</strong><span>${escapeHtml(caseItem.subject)} · ${escapeHtml(caseItem.category)} · ${formatMoney(caseItem.claimedAmount)}</span></div>
      <span class="status ${info.className}">${escapeHtml(info.label)}</span>
      <span class="context-version">材料 v${caseItem.version} · 规则集 v1.2</span>
    </div>`;
  }

  function renderTabs(active, caseItem) {
    const counts = ruleCounts(caseItem);
    const resultCount = counts.unknown + counts.exception;
    return `<nav class="workspace-tabs prototype-tabs" aria-label="案例工作台">
      <button class="${active === "review" ? "is-active" : ""}" type="button" data-action="view-review">字段与证据${hasBlockingFields(caseItem) ? `<span class="tab-count">${fieldEntries(caseItem).filter((field) => field.blocking && field.status !== "human_confirmed" && field.status !== "human_corrected").length}</span>` : ""}</button>
      <button class="${active === "results" ? "is-active" : ""}" type="button" data-action="view-results" ${!caseItem.rules || caseItem.rulesStale ? "disabled" : ""}>预审结果${resultCount ? `<span class="tab-count">${resultCount}</span>` : ""}</button>
      <button class="${active === "timeline" ? "is-active" : ""}" type="button" data-action="view-timeline">审计时间线</button>
    </nav>`;
  }

  function renderDocument(caseItem) {
    const imported = Boolean(caseItem.importKind);
    const amountNeedsReview = caseItem.fields.amount.blocking;
    const evidenceAttributes = (key, warning = false) => `class="evidence-target ${state.focusField === key ? "is-located" : ""} ${warning ? "needs-review" : ""}" data-evidence-field="${key}" tabindex="-1"`;
    const supplement = caseItem.hasExcessExplanation
      ? `<div ${evidenceAttributes("excessExplanation")}><div class="supplement-document"><strong>demo-excess-note-v2.pdf</strong><span>模拟超额说明 · 已加入案例 v${caseItem.version}</span></div></div>`
      : "";
    const attachment = caseItem.attachmentUrl
      ? renderAttachment(caseItem.attachmentUrl, caseItem.attachmentType, caseItem.documentName)
      : "";
    const sourceLabel = attachment ? "附件原件与录入值" : (imported ? "导入的 JSON 字段" : "模拟原文");
    return `<section class="document-panel prototype-document-panel" aria-labelledby="document-title">
      <div class="panel-toolbar"><div><strong id="document-title">${escapeHtml(caseItem.documentName)}</strong></div><span class="document-state">${sourceLabel}</span></div>
      <div class="document-canvas prototype-document"><div class="document-sheet">
        <p class="doc-title">${attachment ? "原件与录入记录" : (imported ? "导入记录" : "模拟电子发票")}</p>
        <div class="doc-grid two">
          <span ${evidenceAttributes("invoiceNumber")}>发票号码：${escapeHtml(caseItem.documentInvoiceNumber)}</span>
          <span ${evidenceAttributes("merchant")}>商户名称：${escapeHtml(caseItem.documentMerchant)}</span>
          <span ${evidenceAttributes("invoiceDate")}>开票日期：${escapeHtml(caseItem.documentDate)}</span>
          <span ${evidenceAttributes("category")}>申请信息 · 费用类别：${escapeHtml(caseItem.category)}</span>
        </div>
        <div ${evidenceAttributes("amount", amountNeedsReview)}>
          <div class="document-amount"><span>${imported ? "导入时票据金额" : "价税合计（小写）"}</span><strong>${formatMoney(caseItem.documentAmount)}</strong></div>
          ${amountNeedsReview ? "<small>金额候选置信度低，请对照原文核对</small>" : ""}
        </div>
        <p class="doc-footnote">申请金额 ${formatMoney(caseItem.claimedAmount)} · 提交日期 ${escapeHtml(caseItem.submissionDate)}</p>
        ${attachment}
      </div></div>
      <div ${evidenceAttributes("materials")}><p class="document-materials">超额说明材料：${caseItem.hasExcessExplanation ? "已收到模拟说明" : "未收到"}</p></div>
      ${supplement}
    </section>`;
  }

  function renderFieldRow(caseItem, field) {
    const confidence = confidenceLabel(field);
    const active = state.focusField === field.key || state.editingField === field.key;
    const value = field.status === "unknown" ? "无法确认" : (field.key === "amount" ? formatMoney(field.value) : escapeHtml(field.value));
    let actionMarkup = "";
    if (state.editingField === field.key) {
      const inputValue = field.key === "amount" ? Number(field.value || 0).toFixed(2) : escapeHtml(field.value || "");
      actionMarkup = `<form class="field-edit-form" data-field-form="${field.key}"><label>修正后的值<input data-field-input="${field.key}" value="${inputValue}" inputmode="decimal"></label><label>修正原因<select data-field-reason="${field.key}"><option value="OCR_DIGIT_ERROR">原文与候选不一致</option><option value="MANUAL_CORRECTION">人工核对后修正</option></select></label><div class="field-edit-actions"><button class="action compact secondary" type="button" data-action="cancel-edit">取消</button><button class="action compact primary" type="button" data-action="save-field" data-field="${field.key}">保存并重算</button></div></form>`;
    } else if (field.status === "unknown") {
      actionMarkup = `<div class="field-actions"><button class="action compact secondary" type="button" data-action="edit-field" data-field="${field.key}">修正字段</button><button class="text-button" type="button" data-action="focus-field" data-field="${field.key}">查看证据</button></div>`;
    } else if (field.confidence === "low") {
      actionMarkup = `<div class="field-actions"><button class="action compact secondary" type="button" data-action="confirm-field" data-field="${field.key}">确认候选</button><button class="action compact primary" type="button" data-action="edit-field" data-field="${field.key}">修正字段</button><button class="text-button" type="button" data-action="mark-unknown" data-field="${field.key}">无法判断</button><button class="text-button" type="button" data-action="focus-field" data-field="${field.key}">查看证据</button></div>`;
    } else if (field.status === "machine_extracted" || field.status === "imported") {
      actionMarkup = `<div class="field-actions"><button class="action compact secondary" type="button" data-action="confirm-field" data-field="${field.key}">确认字段</button><button class="action compact primary" type="button" data-action="edit-field" data-field="${field.key}">修正字段</button><button class="text-button" type="button" data-action="focus-field" data-field="${field.key}">查看证据</button></div>`;
    } else {
      actionMarkup = `<div class="field-actions"><button class="action compact secondary" type="button" data-action="edit-field" data-field="${field.key}">修正字段</button><button class="text-button" type="button" data-action="focus-field" data-field="${field.key}">定位证据</button></div>`;
    }
    const candidateNote = field.key === "amount" && field.blocking ? `<span class="field-evidence">候选 ${formatMoney(field.value)} · 原文 ${formatMoney(caseItem.documentAmount)}</span>` : `<span class="field-evidence">来源：${escapeHtml(field.source)}</span>`;
    return `<div class="field-row ${active ? "is-active" : ""} ${field.status === "unknown" ? "is-unknown" : ""}" data-field-row="${field.key}"><div class="field-label"><span>${escapeHtml(field.label)}</span><span class="confidence ${confidence.className}">${escapeHtml(confidence.text)}</span></div><div class="field-value-line"><strong>${value}</strong>${field.status === "machine_extracted" ? `<span>机器候选</span>` : ""}</div>${candidateNote}${actionMarkup}</div>`;
  }

  function renderReview() {
    const caseItem = currentCase();
    if (!caseItem) return renderHome();
    const fields = fieldEntries(caseItem);
    const blocking = hasBlockingFields(caseItem);
    const staleNote = caseItem.rulesStale ? `<div class="prototype-note warning"><strong>旧结果已过期</strong><span>字段或材料发生变化，请重新运行规则；旧运行仍保留在时间线。</span></div>` : "";
    const unknownNote = fields.some((field) => field.status === "unknown") ? `<div class="prototype-note warning"><strong>存在未知字段</strong><span>相关规则会返回 UNKNOWN，不会被默认视为通过。</span></div>` : "";
    return `<div class="prototype-content workspace-main"><div class="app-frame prototype-workspace">${renderCaseContext(caseItem)}${renderTabs("review", caseItem)}${staleNote}${unknownNote}<div class="review-layout"><div>${renderDocument(caseItem)}</div><section class="fields-panel prototype-fields" aria-labelledby="fields-title"><div class="panel-toolbar"><div><strong id="fields-title">关键字段</strong><span>${fields.length} 项 · ${fields.filter((field) => field.status === "unknown" || field.confidence === "low" || (field.confidence === "medium" && field.status === "machine_extracted")).length} 项需处理</span></div></div><div class="field-list">${fields.map((field) => renderFieldRow(caseItem, field)).join("")}</div>${blocking ? `<div class="prototype-note warning prototype-blocking-note"><strong>需先处理阻断字段</strong><span>保存确认或标记 UNKNOWN 后，才能运行规则检查。</span></div>` : (caseItem.rulesStale ? `<div class="prototype-note warning prototype-blocking-note"><strong>需要重新运行规则</strong><span>当前页面仍保留旧运行的审计记录，但不能据此提交决定。</span></div>` : "")}<div class="view-actions panel-footer"><button class="action secondary" type="button" data-action="save-draft">保存草稿</button><button class="action primary" type="button" data-action="run-precheck" ${blocking ? "disabled" : ""}>${caseItem.rulesStale ? "重新运行规则" : "运行规则检查"}</button></div></section></div></div></div>`;
  }

  function renderStatusSummary(caseItem) {
    const counts = ruleCounts(caseItem);
    return `<div class="status-summary prototype-summary" aria-label="规则状态统计"><div class="summary-cell unknown-cell"><span>UNKNOWN</span><strong>${counts.unknown}</strong><small>需人工判断</small></div><div class="summary-cell exception-cell"><span>EXCEPTION</span><strong>${counts.exception}</strong><small>明确异常</small></div><div class="summary-cell pass-cell"><span>PASS</span><strong>${counts.pass}</strong><small>规则通过</small></div></div>`;
  }

  function renderRuleRow(rule) {
    const meta = ruleStatusMeta(rule.status);
    const interactive = rule.status !== "PASS";
    const tag = interactive ? "button" : "div";
    return `<${tag} class="rule-row ${meta.className}-row prototype-rule-row" ${interactive ? `type="button" data-action="open-finding" data-rule-id="${escapeHtml(rule.id)}"` : ""}><span class="rule-marker">${meta.marker}</span><span class="rule-copy"><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(rule.reason)}</small></span><span class="status ${meta.className}">${meta.label}</span><span class="row-arrow">${interactive ? "›" : ""}</span></${tag}>`;
  }

  function renderResults() {
    const caseItem = currentCase();
    if (!caseItem || !caseItem.rules) return renderReview();
    const counts = ruleCounts(caseItem);
    const stale = caseItem.rulesStale;
    const canDecision = !stale && caseItem.status === "checked";
    const staleNote = stale ? `<div class="prototype-note warning"><strong>结果已过期</strong><span>请回到字段页确认变更并重新运行；当前旧结果不能提交人工决定。</span></div>` : "";
    return `<div class="prototype-content workspace-main"><div class="app-frame prototype-workspace">${renderCaseContext(caseItem)}${renderTabs("results", caseItem)}<div class="workspace-content">${staleNote}<div class="view-header results-header"><div><p class="view-kicker">模拟规则集 v1.2</p><h1>规则检查结果</h1><p>规则结果只是预审辅助；正式审批与付款仍在现有流程中完成。</p></div><button class="action primary" type="button" data-action="open-decision" ${canDecision ? "" : "disabled"}>提交人工决定</button></div>${renderStatusSummary(caseItem)}<div class="rule-list" aria-label="规则检查列表">${sortedRules(caseItem).map(renderRuleRow).join("")}</div>${counts.unknown || counts.exception ? `<div class="prototype-note warning results-footnote"><strong>当前不能自动通过</strong><span>请打开异常或未知项，关联依据后选择退回或要求补充材料。</span></div>` : `<div class="prototype-note results-footnote"><strong>规则检查全部通过</strong><span>仍需由审核员主动提交“预审通过”决定。</span></div>`}</div></div></div>`;
  }

  function renderFindingOverlay() {
    const caseItem = currentCase();
    const rule = (caseItem?.rules || []).find((item) => item.id === state.selectedRuleId);
    if (!caseItem || !rule) return "";
    const meta = ruleStatusMeta(rule.status);
    const isUnknown = rule.status === "UNKNOWN";
    const evidenceField = rule.evidenceField || (rule.id === "required_fields" ? fieldEntries(caseItem).find((field) => field.status === "unknown")?.key : "amount") || "amount";
    const suggestedItems = (rule.actionItems || []).map((item) => ({ item, source: "系统建议" }));
    const humanItems = (caseItem.actionListEdits?.[rule.id] || []).map((item) => ({ item, source: "人工补充" }));
    const actionItems = [...suggestedItems, ...humanItems];
    const actionList = actionItems.length ? `<div class="action-list">${actionItems.map((entry, index) => `<label><input type="checkbox" data-action-item="${index}" checked><span><small>${entry.source}</small>${escapeHtml(entry.item)}</span></label>`).join("")}</div>` : `<p class="field-evidence">当前规则不需要补充行动。</p>`;
    const expectedLabel = rule.id === "travel_limit" ? "规则上限" : "申请金额";
    const comparison = !isUnknown && rule.actual !== undefined
      ? `<dl class="comparison-list"><div><dt>实际值</dt><dd>${formatMoney(rule.actual)}</dd></div><div><dt>${expectedLabel}</dt><dd>${formatMoney(rule.expected)}</dd></div><div><dt>状态</dt><dd>${meta.label}</dd></div></dl>`
      : "";
    return `<div class="prototype-overlay prototype-finding-overlay"><aside class="prototype-finding-dialog" role="dialog" aria-modal="true" aria-labelledby="finding-title">
      <div class="drawer-header"><div><span class="status ${meta.className}">${meta.label}</span><h2 id="finding-title">${escapeHtml(rule.name)}</h2></div><button class="dialog-close" type="button" data-action="close-finding" aria-label="关闭详情">&times;</button></div>
      <section class="detail-section"><h3>${isUnknown ? "为什么无法判断" : "为什么出现异常"}</h3><p>${escapeHtml(rule.reason)}</p>${comparison}</section>
      <section class="detail-section"><h3>判断依据</h3><p><strong>规则：</strong>${escapeHtml(rule.id)} · policy_demo_travel v1.2</p><a class="evidence-link" href="#" data-action="back-to-field" data-field="${evidenceField}">${escapeHtml(rule.evidence)}</a></section>
      <section class="detail-section"><h3>${isUnknown ? "建议补充" : "行动清单（模拟）"}</h3>${actionList}<div class="action-add-form"><label>补充一项人工说明<input data-action-draft placeholder="例如：说明负责人确认依据"></label><button class="action compact secondary" type="button" data-action="save-action-item" data-rule-id="${escapeHtml(rule.id)}">加入清单</button></div><p class="field-evidence">系统建议与人工编辑分别记录。本 Demo 不发送真实通知。</p></section>
      <div class="view-actions drawer-actions"><button class="action secondary" type="button" data-action="back-to-field" data-field="${evidenceField}">查看依据</button>${caseItem.status === "checked" ? '<button class="action primary" type="button" data-action="open-decision">进入人工决定</button>' : ""}</div>
    </aside></div>`;
  }

  function decisionValidation(caseItem, decision) {
    if (!caseItem?.rules || caseItem.rulesStale || caseItem.status !== "checked") return "请先运行当前规则检查。";
    if (!decision?.choice) return "请先选择一项决定。";
    if (decision.choice === "PRECHECK_PASS") {
      return caseItem.rules.some((rule) => rule.status !== "PASS") ? "请先处理异常或未知项。" : "";
    }
    if (!decision.reason.trim()) return "请填写决定理由。";
    if (caseItem.rules.some((rule) => rule.status !== "PASS") && !decision.findingIds.length) return "请至少关联一项异常或未知。";
    return "";
  }

  function refreshDecisionSubmit() {
    const message = decisionValidation(currentCase(), state.decision);
    overlayRoot.querySelector('[data-action="submit-decision"]').disabled = Boolean(message);
    overlayRoot.querySelector("[data-decision-help]").textContent = message;
  }

  function renderDecisionOverlay() {
    const caseItem = currentCase();
    if (!caseItem || !caseItem.rules) return "";
    const counts = ruleCounts(caseItem);
    const unknown = counts.unknown > 0;
    const exception = counts.exception > 0;
    const choice = state.decision?.choice || "";
    const reason = state.decision?.reason || "";
    const findings = sortedRules(caseItem).filter((rule) => rule.status !== "PASS");
    const canPass = !unknown && !exception;
    const needsReason = choice === "RETURN" || choice === "REQUEST_MORE_INFORMATION";
    const validation = decisionValidation(caseItem, state.decision);
    const options = [
      { value: "PRECHECK_PASS", title: "预审通过", description: canPass ? "规则检查全部通过；决定将进入正式流程。" : "存在异常或未知项时，首版不提供覆盖通过。", disabled: !canPass },
      { value: "RETURN", title: "退回修改", description: "将已确认的问题和行动清单交给员工处理。", disabled: false },
      { value: "REQUEST_MORE_INFORMATION", title: "要求补充材料", description: "保留当前案例，等待新材料版本后重新预审。", disabled: false }
    ];
    const optionMarkup = options.map((option) => `
      <label class="decision-row prototype-decision-row ${option.disabled ? "is-disabled" : ""}">
        <input type="radio" name="decision-choice" value="${option.value}" data-decision-choice ${choice === option.value ? "checked" : ""} ${option.disabled ? "disabled" : ""}>
        <span><strong>${option.title}</strong><small>${escapeHtml(option.description)}</small></span>
      </label>`).join("");
    const associationMarkup = findings.map((rule) => `
      <label class="check-row">
        <input type="checkbox" data-finding-choice value="${escapeHtml(rule.id)}" ${(state.decision?.findingIds || []).includes(rule.id) ? "checked" : ""}>
        <span>${escapeHtml(rule.name)} · ${rule.status}</span>
      </label>`).join("");
    const reasonMarkup = needsReason ? `
      <div class="decision-reason">
        <label>决定理由（必填）<textarea data-decision-reason placeholder="说明本次退回或补充的原因">${escapeHtml(reason)}</textarea></label>
        ${findings.length ? `<fieldset class="finding-associations"><legend>关联问题（至少选择一项）</legend>${associationMarkup}</fieldset>` : ""}
      </div>` : "";
    return `
      <div class="prototype-overlay">
        <div class="prototype-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title">
          <div class="dialog-title-row"><div><p class="view-kicker">人工操作</p><h2 id="decision-title">提交预审决定</h2></div><button class="dialog-close" type="button" data-action="close-decision" aria-label="关闭决定确认">&times;</button></div>
          <p class="supporting">AI 建议和规则结果不会替代你的最终决定。</p>
          <div class="dialog-summary"><span><strong>${counts.unknown}</strong> 项未知</span><span><strong>${counts.exception}</strong> 项异常</span><span>依据 ${escapeHtml(caseItem.lastRunId || "当前运行")}</span></div>
          <fieldset class="decision-options prototype-options"><legend>选择决定</legend>${optionMarkup}</fieldset>
          ${reasonMarkup}
          <div class="prototype-note warning compact-notice"><strong>这不是最终财务审批</strong><span>正式审批与付款仍在现有流程中完成。</span></div>
          <p class="field-evidence decision-help" data-decision-help aria-live="polite">${validation}</p>
          <div class="view-actions"><button class="action secondary" type="button" data-action="close-decision">取消</button><button class="action primary" type="button" data-action="submit-decision" ${validation ? "disabled" : ""}>提交人工决定</button></div>
        </div>
      </div>`;
  }

  function renderDecisionSuccess() {
    const decision = state.submittedDecision;
    if (!decision) return "";
    return `<div class="prototype-overlay"><div class="prototype-dialog" role="dialog" aria-modal="true" aria-labelledby="success-title"><div class="dialog-title-row"><div><p class="view-kicker">已保存</p><h2 id="success-title">人工决定已记录</h2></div></div><div class="prototype-note"><strong>${escapeHtml(decision.label)}</strong><span>案例状态、审计时间线和案例入口已同步更新。</span></div><dl class="submitted-summary"><div><dt>案例</dt><dd>${escapeHtml(decision.caseId)}</dd></div><div><dt>依据运行</dt><dd>${escapeHtml(decision.runId)}</dd></div><div><dt>关联问题</dt><dd>${escapeHtml(decision.findingNames || "无")}</dd></div><div><dt>理由</dt><dd>${escapeHtml(decision.reason || "规则检查全部通过")}</dd></div></dl><div class="view-actions"><button class="action primary" type="button" data-action="close-success">查看只读时间线</button></div></div></div>`;
  }

  function renderTimeline() {
    const caseItem = currentCase();
    if (!caseItem) return renderHome();
    const info = statusInfo(caseItem);
    const banner = caseItem.status === "needs_info" ? `<div class="timeline-banner"><div><strong>等待补充材料</strong><span>当前由审核员模拟代上传，员工端与通知不在本 Demo 内。</span></div><button class="action primary" type="button" data-action="simulate-supplement">模拟补充材料</button></div>` : (caseItem.status === "completed" ? `<div class="timeline-banner"><div><strong>预审决定已提交</strong><span>该决定为只读记录；正式审批仍在现有流程中。</span></div><button class="action secondary" type="button" data-action="open-readonly-decision">查看决定详情</button></div>` : (caseItem.status === "returned" ? `<div class="timeline-banner"><div><strong>案例已退回</strong><span>首版将退回视为终态；重新提交属于员工端 P1 范围。</span></div><button class="action secondary" type="button" data-action="go-home">返回案例入口</button></div>` : ""));
    const timeline = caseItem.events.slice().reverse().map((item) => `<li><span class="timeline-dot ${timelineDotClass(item.source)}"></span><time>${escapeHtml(item.at)}</time><div class="timeline-event"><div><strong>${escapeHtml(item.summary)}</strong><span class="source-label ${timelineSourceClass(item.source)}">${escapeHtml(item.source)}</span></div><p>${escapeHtml(item.detail)}</p>${item.type === "DECISION_SUBMITTED" ? `<button class="text-button" type="button" data-action="open-readonly-decision">查看决定详情</button>` : ""}</div></li>`).join("");
    return `<div class="prototype-content workspace-main"><div class="app-frame prototype-workspace">${renderCaseContext(caseItem)}${renderTabs("timeline", caseItem)}<div class="workspace-content prototype-timeline">${banner}<div class="view-header results-header"><div><p class="view-kicker">案例回放</p><h1>处理记录</h1><p>按时间还原材料、字段、规则运行和人工决定；历史事件不会被新版本覆盖。</p></div><button class="action secondary" type="button" data-action="go-home">返回案例入口</button></div><ol class="timeline">${timeline}</ol></div></div></div>`;
  }

  function renderPolicy() {
    return `<div class="prototype-content policy-panel"><div class="view-header"><div><p class="view-kicker">只读说明</p><h1>当前模拟规则</h1><p>以下规则仅用于作品集演示，不代表任何真实税务、法律或公司制度。</p></div><button class="action secondary" type="button" data-action="go-home">返回案例入口</button></div><div class="prototype-note warning"><strong>规则责任边界</strong><span>规则结果不是最终审批；规则不覆盖或输入不确定时返回 UNKNOWN。</span></div><section class="policy-section"><h3>规则集：policy_demo_travel v1.2</h3><p>发布状态：模拟已发布 · 规则集版本会绑定每一次预审运行。</p><div class="policy-rule-list"><div><strong>TRAVEL_LIMIT_001 · v1.1</strong><span>差旅单笔金额不超过 ¥200.00</span></div><div><strong>REQUIRED_FIELDS_001 · v1.0</strong><span>金额、日期、商户、票号和费用类别可用</span></div><div><strong>DATE_WINDOW_001 · v1.0</strong><span>票据日期处于模拟提交窗口内</span></div><div><strong>EXPLANATION_001 · v1.0</strong><span>超出模拟额度时需要补充说明材料</span></div></div></section><section class="policy-section"><h3>不在本 Demo 内</h3><p>自动付款、最终审批、发票真伪验真、税务/法律结论、真实系统集成和员工通知。</p></section></div>`;
  }

  function timelineDotClass(source) {
    if (source === "审核员" || source.includes("模拟")) return "human-dot";
    if (source === "规则引擎") return "rule-dot";
    if (source === "文档理解") return "ai-dot";
    return "system-dot";
  }

  function timelineSourceClass(source) {
    if (source === "审核员" || source.includes("模拟")) return "human-source";
    if (source === "规则引擎") return "rule-source";
    if (source === "文档理解") return "ai-source";
    return "system-source";
  }

  function beginCase(caseItem) {
    state.selectedCaseId = caseItem.id;
    state.selectedRuleId = null;
    state.focusField = null;
    state.editingField = null;
    if (caseItem.status === "needs_info" || caseItem.status === "completed" || caseItem.status === "returned") {
      setView("timeline");
    } else if (caseItem.rules && !caseItem.rulesStale) {
      setView("results");
    } else {
      setView("review");
    }
  }

  function saveField(fieldKey) {
    const caseItem = currentCase();
    const input = viewRoot.querySelector(`[data-field-input="${fieldKey}"]`);
    const reason = viewRoot.querySelector(`[data-field-reason="${fieldKey}"]`)?.value || "MANUAL_CORRECTION";
    if (!caseItem || !input) return;
    const oldValue = caseItem.fields[fieldKey].value;
    const rawValue = input.value.trim();
    if (!rawValue || (fieldKey === "amount" && !isMoney(rawValue)) ||
        (fieldKey === "invoiceDate" && !Number.isFinite(isoDateTime(rawValue))) ||
        (fieldKey === "category" && !expenseCategories.includes(rawValue))) {
      showToast("请填写有效的修正值。", "error");
      return;
    }
    caseItem.fields[fieldKey].value = fieldKey === "amount" ? Number(rawValue) : rawValue;
    caseItem.fields[fieldKey].status = "human_corrected";
    caseItem.fields[fieldKey].confidence = "human";
    caseItem.fields[fieldKey].blocking = false;
    invalidateRun(caseItem);
    addEvent(caseItem, "FIELD_CORRECTED", "审核员", `修正${FIELD_META[fieldKey].label}`, `${oldValue} → ${caseItem.fields[fieldKey].value} · ${reason}`);
    state.editingField = null;
    state.focusField = fieldKey;
    showToast("字段已保存，受影响规则需要重新运行。", "");
    render();
  }

  function updateFieldStatus(fieldKey, status) {
    const caseItem = currentCase();
    if (!caseItem) return;
    const field = caseItem.fields[fieldKey];
    if (status === "unknown") {
      field.value = null;
      field.status = "unknown";
      field.confidence = "low";
      field.blocking = false;
      addEvent(caseItem, "FIELD_MARKED_UNKNOWN", "审核员", `标记${FIELD_META[fieldKey].label}为 UNKNOWN`, "相关规则将转为 UNKNOWN");
    } else {
      field.status = "human_confirmed";
      field.confidence = "human";
      field.blocking = false;
      addEvent(caseItem, "FIELD_CONFIRMED", "审核员", `确认${FIELD_META[fieldKey].label}`, `使用当前候选值 ${field.value}`);
    }
    invalidateRun(caseItem);
    state.editingField = null;
    state.focusField = fieldKey;
    render();
  }

  function submitDecision() {
    const caseItem = currentCase();
    const decision = state.decision;
    const validation = decisionValidation(caseItem, decision);
    if (validation) {
      showToast(validation, "error");
      return;
    }
    const labels = { PRECHECK_PASS: "预审通过", RETURN: "退回修改", REQUEST_MORE_INFORMATION: "要求补充材料" };
    const findingNames = (caseItem.rules || []).filter((rule) => decision.findingIds.includes(rule.id)).map((rule) => rule.name).join("、");
    const runId = caseItem.lastRunId || "unknown-run";
    caseItem.status = decision.choice === "PRECHECK_PASS" ? "completed" : (decision.choice === "RETURN" ? "returned" : "needs_info");
    caseItem.submittedDecision = { choice: decision.choice, label: labels[decision.choice], reason: decision.reason, findingNames, runId, caseId: caseItem.id };
    addEvent(caseItem, "DECISION_SUBMITTED", "审核员", `人工决定：${labels[decision.choice]}`, `${decision.reason || "规则检查全部通过"} · 依据 ${runId}`);
    state.submittedDecision = caseItem.submittedDecision;
    state.decision = null;
    state.view = "timeline";
    render();
    overlayRoot.innerHTML = renderDecisionSuccess();
  }

  function simulateSupplement() {
    const caseItem = currentCase();
    if (!caseItem || caseItem.status !== "needs_info") return;
    beginProcessing("supplement", caseItem);
  }

  function handleClick(event) {
    const trigger = event.target.closest("[data-action]");
    if (!trigger) return;
    event.preventDefault();
    const action = trigger.dataset.action;
    const caseItem = currentCase();
    if (action === "go-home") { state.selectedCaseId = null; state.submittedDecision = null; setView("home"); return; }
    if (action === "go-create") { state.fileFailure = false; setView("create"); return; }
    if (action === "go-import") { setView("import"); return; }
    if (action === "show-policy") { setView("policy"); return; }
    if (action === "reset-demo") { resetDemo(); showToast("演示状态已重置。", ""); return; }
    if (action === "select-case") { const item = Object.values(state.cases).find((candidate) => candidate.id === trigger.dataset.caseId); if (item) beginCase(item); return; }
    if (action === "start-preset") { const item = caseByKey(state.selectedPreset); if (item) { state.selectedCaseId = item.id; state.fileFailure = false; beginProcessing("create", item); } return; }
    if (action === "show-file-failure") { state.fileFailure = true; render(); return; }
    if (action === "retry-file") { state.fileFailure = false; showToast("已恢复为预置案例入口，请选择合成案例。", ""); render(); return; }
    if (!caseItem && ["view-review", "view-results", "view-timeline"].includes(action)) return;
    if (action === "view-review") { setView("review"); return; }
    if (action === "view-results") { if (!caseItem.rules || caseItem.rulesStale) { showToast("当前结果不可用，请先重新运行规则。", "warning"); return; } setView("results"); return; }
    if (action === "view-timeline") { setView("timeline"); return; }
    if (action === "edit-field") { state.editingField = trigger.dataset.field; state.focusField = trigger.dataset.field; render(); return; }
    if (action === "cancel-edit") { state.editingField = null; render(); return; }
    if (action === "save-field") { saveField(trigger.dataset.field); return; }
    if (action === "confirm-field") { updateFieldStatus(trigger.dataset.field, "confirmed"); showToast("字段已确认。", ""); return; }
    if (action === "mark-unknown") { updateFieldStatus(trigger.dataset.field, "unknown"); showToast("字段已标记 UNKNOWN，相关规则会保留不确定性。", "warning"); return; }
    if (action === "focus-field") { locateEvidence(trigger.dataset.field); return; }
    if (action === "save-draft") { addEvent(caseItem, "DRAFT_SAVED", "审核员", "保存字段核对草稿", "尚未提交人工决定"); showToast("草稿已保存。", ""); return; }
    if (action === "run-precheck") { if (hasBlockingFields(caseItem)) { showToast("请先处理阻断字段。", "warning"); return; } beginProcessing("rules", caseItem); return; }
    if (action === "open-finding") { state.selectedRuleId = trigger.dataset.ruleId; overlayRoot.innerHTML = renderFindingOverlay(); return; }
    if (action === "close-finding") { overlayRoot.innerHTML = ""; state.selectedRuleId = null; return; }
    if (action === "back-to-field") { locateEvidence(trigger.dataset.field); return; }
    if (action === "save-action-item") {
      const input = overlayRoot.querySelector("[data-action-draft]");
      const text = input?.value.trim();
      if (!text || !caseItem) { showToast("请先填写一项明确的补充说明。", "warning"); return; }
      const ruleId = trigger.dataset.ruleId;
      caseItem.actionListEdits ||= {};
      caseItem.actionListEdits[ruleId] ||= [];
      caseItem.actionListEdits[ruleId].push(text);
      const rule = (caseItem.rules || []).find((item) => item.id === ruleId);
      addEvent(caseItem, "ACTION_LIST_EDITED", "审核员", "补充行动清单", `${rule?.name || ruleId} · ${text}`);
      overlayRoot.innerHTML = renderFindingOverlay();
      showToast("人工补充项已加入清单，并已记录到时间线。", "");
      return;
    }
    if (action === "open-decision") { if (!caseItem.rules || caseItem.rulesStale || caseItem.status !== "checked") return; state.decision = { choice: "", reason: "", findingIds: [] }; overlayRoot.innerHTML = renderDecisionOverlay(); return; }
    if (action === "close-decision") { state.decision = null; overlayRoot.innerHTML = ""; return; }
    if (action === "submit-decision") { submitDecision(); return; }
    if (action === "close-success") { state.submittedDecision = null; overlayRoot.innerHTML = ""; render(); return; }
    if (action === "open-readonly-decision") { overlayRoot.innerHTML = renderReadonlyDecision(); return; }
    if (action === "close-readonly") { overlayRoot.innerHTML = ""; return; }
    if (action === "simulate-supplement") { simulateSupplement(); return; }
  }

  function renderReadonlyDecision() {
    const caseItem = currentCase();
    const decision = caseItem?.submittedDecision;
    if (!caseItem || !decision) return "";
    return `<div class="prototype-overlay"><div class="prototype-dialog" role="dialog" aria-modal="true" aria-labelledby="readonly-title"><div class="dialog-title-row"><div><p class="view-kicker">只读记录</p><h2 id="readonly-title">人工决定详情</h2></div><button class="dialog-close" type="button" data-action="close-readonly" aria-label="关闭只读详情">&times;</button></div><div class="prototype-note"><strong>${escapeHtml(decision.label)}</strong><span>此记录已提交，不能在原事件上直接修改。</span></div><dl class="submitted-summary"><div><dt>案例</dt><dd>${escapeHtml(caseItem.id)}</dd></div><div><dt>依据运行</dt><dd>${escapeHtml(decision.runId)}</dd></div><div><dt>关联问题</dt><dd>${escapeHtml(decision.findingNames || "无")}</dd></div><div><dt>理由</dt><dd>${escapeHtml(decision.reason || "规则检查全部通过")}</dd></div></dl><div class="view-actions"><button class="action secondary" type="button" data-action="close-readonly">关闭</button></div></div></div>`;
  }

  function handleChange(event) {
    const target = event.target;
    if (target.matches('[data-import-form] input[type="file"]')) { handleImportFile(target); return; }
    if (target.matches("[data-preset]")) {
      state.selectedPreset = target.value;
      render();
      return;
    }
    if (target.matches("[data-decision-choice]")) {
      if (!state.decision) state.decision = { choice: "", reason: "", findingIds: [] };
      state.decision.choice = target.value;
      overlayRoot.innerHTML = renderDecisionOverlay();
      return;
    }
    if (target.matches("[data-finding-choice]")) {
      if (!state.decision) return;
      const id = target.value;
      const ids = new Set(state.decision.findingIds || []);
      if (target.checked) ids.add(id); else ids.delete(id);
      state.decision.findingIds = Array.from(ids);
      refreshDecisionSubmit();
    }
  }

  function handleInput(event) {
    if (event.target.matches("[data-decision-reason]")) {
      if (!state.decision) return;
      state.decision.reason = event.target.value;
      refreshDecisionSubmit();
    }
  }

  appRoot.addEventListener("click", handleClick);
  appRoot.addEventListener("change", handleChange);
  appRoot.addEventListener("input", handleInput);
  appRoot.addEventListener("submit", (event) => {
    const field = event.target.dataset.fieldForm;
    if (field) { event.preventDefault(); saveField(field); return; }
    importCase(event);
  });

  function resetDemo() {
    const nextToken = state.processingToken + 1;
    for (const caseItem of Object.values(state.cases)) {
      if (caseItem.attachmentUrl) URL.revokeObjectURL(caseItem.attachmentUrl);
    }
    state = createInitialState();
    state.processingToken = nextToken;
    setView("home");
  }

  window.__expensePrototype = {
    getState: () => clone(state),
    reset: resetDemo,
    selectCase: (key) => { const item = caseByKey(key); if (item) beginCase(item); },
    runRules: () => { const item = currentCase(); if (item) beginProcessing("rules", item); }
  };

  render();
})();

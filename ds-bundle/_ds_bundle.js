/* @ds-bundle: {"format":3,"namespace":"Watson_d19e3c","components":[{"name":"PriorityBadge","sourcePath":"components/Components/PriorityBadge/PriorityBadge.jsx"},{"name":"TaskCard","sourcePath":"components/Components/TaskCard/TaskCard.jsx"}],"sourceHashes":{"components/Components/PriorityBadge/PriorityBadge.jsx":"40639b68d4ed","components/Components/TaskCard/TaskCard.jsx":"03432e0c77ac"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.Watson_d19e3c = window.Watson_d19e3c || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/Components/PriorityBadge/PriorityBadge.jsx
try { (() => {
// Watson — PriorityBadge
// R6: priorita je NEBAREVNÝ odznak P1–P4, nezávislý na uživatelských barvách.
// Zdroj pravdy: packages/ui/src/PriorityBadge.tsx (tam přes Tailwind utility + var(--w-*)).
// Tady plain-CSS varianta (třída .w-priority-badge z components.css) pro Claude Design.

function PriorityBadge({
  priority,
  className = ""
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `w-priority-badge ${className}`.trim(),
    "data-priority": priority,
    "aria-label": `Priorita P${priority}`
  }, "P", priority);
}
Object.assign(__ds_scope, { PriorityBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Components/PriorityBadge/PriorityBadge.jsx", error: String((e && e.message) || e) }); }

// components/Components/TaskCard/TaskCard.jsx
try { (() => {
// Watson — TaskCard
// Karta úkolu: název, prioritní odznak (R6), uživatelská barva (samostatný akcent),
// termín (deadline po termínu červeně), status chip, přiřazení.
// Dva režimy přiřazení (R2) MUSÍ jít vizuálně odlišit:
//   - shared_any → jeden avatar (stačí kdokoli),
//   - shared_all → per-osoba progres „3/5" + skupina avatarů.

function TaskCard({
  name,
  priority,
  color = "var(--w-ink-3)",
  // uživatelská barva úkolu/projektu — NE priorita
  due,
  // { label: "Po termínu · út", overdue: true }
  status,
  // "Probíhá" | "Ke kontrole" | …
  assignment // { mode: "shared_all", done: 3, total: 5, people: ["T","M"] } | { mode, people }
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "w-task-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-task-card__top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-task-card__dot",
    style: {
      background: color
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "w-task-card__name"
  }, name)), /*#__PURE__*/React.createElement("div", {
    className: "w-task-card__meta"
  }, /*#__PURE__*/React.createElement(__ds_scope.PriorityBadge, {
    priority: priority
  }), due && /*#__PURE__*/React.createElement("span", {
    className: `w-chip ${due.overdue ? "w-chip--overdue" : ""}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-num"
  }, due.label)), status && /*#__PURE__*/React.createElement("span", {
    className: "w-chip w-chip--status"
  }, status), /*#__PURE__*/React.createElement("span", {
    className: "w-task-card__assignees"
  }, assignment?.mode === "shared_all" ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "w-chip"
  }, "Každ\xFD zvl\xE1šť \xB7 ", /*#__PURE__*/React.createElement("span", {
    className: "w-num"
  }, assignment.done, "/", assignment.total)), /*#__PURE__*/React.createElement("span", {
    className: "w-avatar-group"
  }, assignment.people.map((p, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: `w-avatar ${i === 0 ? "w-avatar--brass" : ""}`
  }, p)))) : assignment?.people?.map((p, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "w-avatar"
  }, p)))));
}
Object.assign(__ds_scope, { TaskCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Components/TaskCard/TaskCard.jsx", error: String((e && e.message) || e) }); }

__ds_ns.PriorityBadge = __ds_scope.PriorityBadge;

__ds_ns.TaskCard = __ds_scope.TaskCard;

})();

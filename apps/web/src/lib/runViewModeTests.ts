import assert from "node:assert/strict";
import {
	defaultViewStorageKey,
	nextDefaultView,
	normalizeDefaultView,
	viewSurfaceForPath,
} from "./viewMode";

assert.equal(viewSurfaceForPath("/"), "tasks");
assert.equal(viewSurfaceForPath("/ukoly"), "tasks");
assert.equal(viewSurfaceForPath("/ukoly?tab=zasobnik"), "tasks");
assert.equal(viewSurfaceForPath("/schranka"), "tasks");
assert.equal(viewSurfaceForPath("/nadchazejici"), "upcoming");
assert.equal(viewSurfaceForPath("/oblibene/p1"), "favorites");
assert.equal(viewSurfaceForPath("/mail"), null);

assert.equal(normalizeDefaultView("tasks", "calendar"), "list");
assert.equal(normalizeDefaultView("tasks", "board"), "board");
assert.equal(normalizeDefaultView("upcoming", "calendar"), "calendar");
assert.equal(nextDefaultView(null, "board"), "board");
assert.equal(nextDefaultView("list", "board"), "board");
assert.equal(nextDefaultView("board", "board"), null);
assert.equal(normalizeDefaultView("favorites", "calendar"), "calendar");
assert.equal(normalizeDefaultView("tasks", "broken"), null);

assert.notEqual(defaultViewStorageKey("tasks"), defaultViewStorageKey("upcoming"));
assert.notEqual(defaultViewStorageKey("tasks"), defaultViewStorageKey("favorites"));

console.log("viewMode: per-surface defaults, routing and legacy normalization passed");

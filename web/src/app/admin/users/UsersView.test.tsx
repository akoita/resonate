import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import UsersView, { UsersFilters, UsersPager, UsersResults, type UsersViewProps } from "./UsersView";
import { DEFAULT_ADMIN_USERS_FILTERS } from "../../../lib/adminUsers";
import { OVERVIEW, userRow, usersPage } from "../../../lib/__fixtures__/adminUsers";

function props(overrides: Partial<UsersViewProps> = {}): UsersViewProps {
  return {
    list: { status: "ready", page: usersPage() },
    overview: { status: "ready", overview: OVERVIEW },
    filters: DEFAULT_ADMIN_USERS_FILTERS,
    searchText: "",
    searchError: null,
    onSearchTextChange: vi.fn(),
    onSearchSubmit: vi.fn(),
    onFiltersChange: vi.fn(),
    onClearFilters: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

const render = (overrides: Partial<UsersViewProps> = {}) => renderToStaticMarkup(<UsersView {...props(overrides)} />);

/** Every element in a React tree (host elements and unexpanded components) that matches. */
function findAll(node: React.ReactNode, match: (element: React.ReactElement<Record<string, unknown>>) => boolean) {
  const found: Array<React.ReactElement<Record<string, unknown>>> = [];
  const visit = (value: React.ReactNode) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!React.isValidElement<Record<string, unknown>>(value)) return;
    if (match(value)) found.push(value);
    visit(value.props.children as React.ReactNode);
  };
  visit(node);
  return found;
}

function filtersTree(overrides: Partial<UsersViewProps> = {}) {
  const p = props(overrides);
  return { p, tree: UsersFilters(p) };
}

function change(tree: React.ReactNode, label: string, value: string) {
  const [select] = findAll(tree, (el) => el.type === "select" && el.props["aria-label"] === label);
  expect(select, `select ${label}`).toBeDefined();
  (select!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

describe("UsersView (#2166)", () => {
  it("renders the overview tiles with the 7 and 30 day figures", () => {
    const html = render();
    expect(html).toContain("1,234");
    expect(html).toContain("People");
    expect(html).toContain("New in 7 days");
    expect(html).toContain("80 in 30 days");
    expect(html).toContain("Active in 24 hours");
    expect(html).toContain("480 in 30 days");
    expect(html).toContain("Suspended");
    expect(html).toContain("Closed");
    expect(html).toContain("16 Oct 2026");
  });

  it("keeps the list usable when the overview fails or is loading", () => {
    expect(render({ overview: { status: "error" } })).toContain("overview could not be loaded");
    expect(render({ overview: { status: "loading" } })).toContain("Loading overview");
    expect(render({ overview: { status: "error" } })).toContain("Nova");
  });

  it("renders one row per person linking to the record, with roles, status and the activity day", () => {
    const html = render();
    expect(html).toContain('href="/admin/users/11111111-aaaa-bbbb-cccc-000000000001"');
    expect(html).toContain('href="/admin/users/22222222-aaaa-bbbb-cccc-000000000002"');
    expect(html).toContain("0x1234...5678");
    expect(html).toContain("Nova");
    expect(html).toContain(">Artist<");
    expect(html).toContain(">Listener<");
    expect(html).toContain("admin-users-chip--suspended");
    expect(html).toContain("admin-users-chip--active");
    // The activity day, not a time.
    expect(html).toContain("15 Oct 2026");
    expect(html).toContain("14 Oct 2026");
    expect(html).toContain('data-label="Last active"');
    expect(html).toContain(">Never<");
    // No contact email is part of this view.
    expect(html).not.toMatch(/@/);
  });

  it("flags a possible duplicate account on its row only", () => {
    expect(render()).not.toContain("Possible duplicate");
    const html = render({
      list: {
        status: "ready",
        page: usersPage({
          items: [userRow({ possibleDuplicate: true }), userRow({ id: "22222222-aaaa-bbbb-cccc-000000000002" })],
        }),
      },
    });
    expect(html.match(/Possible duplicate</g)).toHaveLength(1);
  });

  it("shows the active filter values and a clear action", () => {
    const html = render({
      filters: { ...DEFAULT_ADMIN_USERS_FILTERS, status: "suspended", role: "artist", inactiveForDays: 30, q: "nova" },
      searchText: "nova",
    });
    expect(html).toContain('value="nova"');
    expect(html).toMatch(/<option value="suspended" selected/);
    expect(html).toMatch(/<option value="artist" selected/);
    expect(html).toMatch(/<option value="inactive:30" selected/);
    expect(html).toContain("Clear filters");
    expect(render()).not.toContain("Clear filters");
  });

  it("updates the query when a filter changes and returns to the first page", () => {
    const { p, tree } = filtersTree({ filters: { ...DEFAULT_ADMIN_USERS_FILTERS, page: 4 } });
    change(tree, "Status", "closed");
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_ADMIN_USERS_FILTERS, status: "closed", page: 1 });
    change(tree, "Role", "listener");
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_ADMIN_USERS_FILTERS, role: "listener", page: 1 });
    change(tree, "Activity", "active:7");
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_ADMIN_USERS_FILTERS, activeWithinDays: 7, page: 1 });
    change(tree, "Sort by", "lastActiveAt");
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_ADMIN_USERS_FILTERS, sort: "lastActiveAt", page: 1 });
    change(tree, "Order", "asc");
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_ADMIN_USERS_FILTERS, order: "asc", page: 1 });
    // "Any" removes the filter.
    change(tree, "Status", "");
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_ADMIN_USERS_FILTERS, status: undefined, page: 1 });
  });

  it("submits the search from the form and reports typing", () => {
    const { p, tree } = filtersTree();
    const [form] = findAll(tree, (el) => el.type === "form");
    const preventDefault = vi.fn();
    (form!.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(p.onSearchSubmit).toHaveBeenCalledTimes(1);
    const [input] = findAll(tree, (el) => el.type === "input");
    (input!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "0xab" } });
    expect(p.onSearchTextChange).toHaveBeenCalledWith("0xab");
  });

  it("shows a search problem inline and marks the field invalid", () => {
    const html = render({ searchError: "Type at least 2 characters.", searchText: "a" });
    expect(html).toContain("Type at least 2 characters.");
    expect(html).toContain('aria-invalid="true"');
  });

  it("paginates: shows the window and disables Previous on the first page and Next on the last", () => {
    const html = render({ list: { status: "ready", page: usersPage({ page: 1, total: 60 }) } });
    expect(html).toContain("Showing 1-2 of 60");
    expect(html).toContain("Page 1 of 3");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Previous<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);

    const last = render({ list: { status: "ready", page: usersPage({ page: 3, total: 60 }) } });
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
  });

  it("wires the pager buttons to the adjacent pages", () => {
    const onPage = vi.fn();
    const tree = UsersPager({ page: usersPage({ page: 2, total: 80 }), onPage });
    const buttons = findAll(tree, (el) => typeof el.props.onClick === "function");
    expect(buttons).toHaveLength(2);
    (buttons[0]!.props.onClick as () => void)();
    expect(onPage).toHaveBeenLastCalledWith(1);
    (buttons[1]!.props.onClick as () => void)();
    expect(onPage).toHaveBeenLastCalledWith(3);
  });

  it("turns a page change into a filter change that keeps the other filters", () => {
    const onFiltersChange = vi.fn();
    const filters = { ...DEFAULT_ADMIN_USERS_FILTERS, status: "active" as const, page: 2 };
    const tree = UsersResults({
      ...props({ list: { status: "ready", page: usersPage({ page: 2, total: 80 }) }, filters, onFiltersChange }),
    });
    const [pager] = findAll(tree, (el) => el.type === UsersPager);
    (pager!.props.onPage as (page: number) => void)(3);
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, page: 3 });
  });

  it("marks the table busy while a newer page loads", () => {
    expect(render({ list: { status: "ready", page: usersPage(), refreshing: true } })).toContain('aria-busy="true"');
    expect(render()).not.toContain('aria-busy="true"');
  });

  it("explains an empty directory and an empty filtered result differently", () => {
    const empty = { status: "ready" as const, page: usersPage({ items: [], total: 0 }) };
    const none = render({ list: empty });
    expect(none).toContain("No users yet");
    expect(none).not.toContain("Clear filters");

    const filtered = render({ list: empty, filters: { ...DEFAULT_ADMIN_USERS_FILTERS, status: "closed" } });
    expect(filtered).toContain("No one matches these filters");
    expect(filtered).toContain("Clear filters");
  });

  it("offers a way back when the page is past the end", () => {
    const html = render({ list: { status: "ready", page: usersPage({ items: [], total: 30, page: 9 }) } });
    expect(html).toContain("That page is empty");
    expect(html).toContain("Back to the first page");
  });

  it("shows a loading state without rows", () => {
    const html = render({ list: { status: "loading" } });
    expect(html).toContain("Loading people");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("<table");
  });

  it("shows an error with a retry", () => {
    const html = render({ list: { status: "error", message: "Request failed" } });
    expect(html).toContain("People could not be loaded");
    expect(html).toContain("Request failed");
    expect(html).toContain("Try again");
  });

  it("shows only an access message, and no data or filters, when the server says 403", () => {
    const html = render({ list: { status: "forbidden" } });
    expect(html).toContain("Admins and operators only");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("1,234");
    expect(html).not.toContain("Search");
  });
});

// app.js — NammaArea Bangalore v1
// Plain ES5-compatible JS (no modules) — uses Leaflet + Turf globals.

(function () {
  "use strict";

  // ---------- State ----------

  var state = {
    lat: null,
    lng: null,
    pincode: null,
    pc: null,
    pc_code: null,
    ac: null,
    ac_code: null,
    ward_no: null,
    ward_name: null,
    mp: null,
    mla: null,
    corporator: null,
    works: [],
    works_data: [],
    wards_data: null,
    pcac_data: null,
    mps_data: [],
    mlas_data: [],
    corporators_data: [],
    utilities_data: [],
    services_data: [],
    data_loaded_at: null,
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  function setStatus(msg, level) {
    var node = $("#location-status");
    node.textContent = msg;
    node.classList.remove("error", "success");
    if (level) node.classList.add(level);
  }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function initials(name) {
    if (!name) return "?";
    var parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function fmtMoney(cr) {
    if (cr === null || cr === undefined) return "—";
    return "₹" + Number(cr).toFixed(1) + " cr";
  }

  function statusLevel(d) {
    if (!d) return "in_progress";
    var status = d.status || "in_progress";
    if (d.tender_date) {
      var ageYears = (Date.now() - new Date(d.tender_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (ageYears > 2 && status !== "completed") status = "stale";
    }
    return status;
  }

  // ---------- Data load ----------

  function loadData() {
    var fetches = [
      ["works_data", "data/works.json"],
      ["wards_data", "data/wards.geojson"],
      ["pcac_data", "data/pc-ac.json"],
      ["mps_data", "data/mps.json"],
      ["mlas_data", "data/mlas.json"],
      ["corporators_data", "data/corporators.json"],
      ["utilities_data", "data/utilities.json"],
      ["services_data", "data/services.json"],
    ];
    var tasks = fetches.map(function (pair) {
      var key = pair[0], url = pair[1];
      return fetch(url, { cache: "no-cache" })
        .then(function (r) {
          if (!r.ok) throw new Error("Failed to fetch " + url + ": " + r.status);
          return r.json();
        })
        .then(function (data) { state[key] = data; })
        .catch(function (err) {
          console.error("Failed to load", url, err);
          // Keep the key empty but don't break the app
          state[key] = Array.isArray(state[key]) ? [] : null;
        });
    });
    return Promise.all(tasks).then(function () {
      state.data_loaded_at = new Date();
      setDataStamp();
    });
  }

  function setDataStamp() {
    var node = $("#data-stamp");
    var date = state.data_loaded_at || new Date(document.lastModified || Date.now());
    var str = date.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
    node.textContent = "Data bundled as of " + str + " · Live weekly crawl in v1.1";
  }

  // ---------- Location: GPS ----------

  function initGps() {
    var btn = $("#find-me");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!navigator.geolocation) {
        setStatus("Browser doesn't support GPS. Use search or pincode instead.", "error");
        return;
      }
      setStatus("Requesting your location…");
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
          onCoords(pos.coords.latitude, pos.coords.longitude, "GPS");
        },
        function (err) {
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
          var msg = "GPS failed";
          if (err && err.code === 1) msg = "Location permission denied. Use search or pincode instead.";
          else if (err && err.message) msg = "GPS failed (" + err.message + "). Use search or pincode instead.";
          setStatus(msg, "error");
          console.warn(err);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    });
  }

  // ---------- Location: place search (Nominatim) ----------

  function initPlaceSearch() {
    var input = $("#place-search");
    if (!input) return;
    var lastQ = "";
    function search() {
      var q = input.value.trim();
      if (!q || q === lastQ) return;
      lastQ = q;
      setStatus("Searching for \"" + q + "\"…");
      var url = "https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(q) +
                "&format=json&limit=1&countrycodes=in&addressdetails=1";
      fetch(url, { headers: { "Accept-Language": "en" } })
        .then(function (r) {
          if (r.status === 429) throw new Error("rate_limited");
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (j) {
          if (!j || !j.length) throw new Error("no_match");
          var hit = j[0];
          var lat = parseFloat(hit.lat);
          var lng = parseFloat(hit.lon);
          var pc = (hit.address && hit.address.postcode) || null;
          onCoords(lat, lng, "search", pc);
        })
        .catch(function (err) {
          var msg = "Search failed.";
          if (err.message === "rate_limited") msg = "Search is rate-limited. Try again in a few seconds, or use pincode.";
          else if (err.message === "no_match") msg = "No match for \"" + q + "\". Try a different place or pincode.";
          setStatus(msg, "error");
          console.warn(err);
          lastQ = "";
        });
    }
    input.addEventListener("change", search);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); search(); }
    });
  }

  // ---------- Location: pincode ----------

  function initPincodeSearch() {
    var input = $("#pincode-search");
    if (!input) return;
    function go() {
      var pc = input.value.trim();
      if (!/^\d{6}$/.test(pc)) {
        if (pc.length === 6) setStatus("Pincode must be 6 digits.", "error");
        return;
      }
      onPincode(pc);
    }
    input.addEventListener("change", go);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); go(); }
    });
  }

  // ---------- Coords + reverse geocode ----------

  function onCoords(lat, lng, source, postalOverride) {
    state.lat = lat;
    state.lng = lng;
    setStatus("Got coords " + lat.toFixed(4) + ", " + lng.toFixed(4) + ". Resolving area…");

    // Fire reverse geocode unless pincode already known
    var p = Promise.resolve();
    if (!postalOverride) {
      p = fetch("https://nominatim.openstreetmap.org/reverse?lat=" + lat + "&lon=" + lng +
                "&format=json&zoom=18&addressdetails=1", { headers: { "Accept-Language": "en" } })
        .then(function (r) {
          if (!r.ok) return null;
          return r.json();
        })
        .then(function (j) {
          if (j && j.address && j.address.postcode) {
            state.pincode = (j.address.postcode + "").replace(/\D/g, "").slice(0, 6);
          }
        })
        .catch(function (err) { console.warn("Reverse geocode failed", err); });
    } else {
      state.pincode = (postalOverride + "").replace(/\D/g, "").slice(0, 6);
    }

    p.then(function () {
      resolveAllFromCache();
      render();
      setStatus("Resolved: " + describeLocation(), "success");
    });
  }

  function onPincode(pc) {
    var entry = state.pcac_data && state.pcac_data[pc];
    if (!entry) {
      setStatus("Pincode " + pc + " isn't in our (sparse) dataset. Try search or GPS.", "error");
      return;
    }
    state.pincode = pc;
    state.pc = entry.pc;
    state.pc_code = entry.pc_code || null;
    state.ac = entry.ac;
    state.ac_code = entry.ac_code || null;
    // Use bundled lat/lng if we have it; else fall back to Bangalore-center.
    if (typeof entry.lat === "number" && typeof entry.lng === "number") {
      state.lat = entry.lat;
      state.lng = entry.lng;
      setStatus("Pincode " + pc + " → " + entry.pc + " / " + entry.ac + ".");
    } else {
      state.lat = 12.9716;
      state.lng = 77.5946;
      setStatus("Pincode " + pc + " → " + entry.pc + " / " + entry.ac + ". (No bundled coords — using Bangalore-center approximation.)");
    }
    resolveAllFromCache();
    render();
  }

  function describeLocation() {
    var bits = [];
    if (state.ward_name && state.ward_no) bits.push("Ward " + state.ward_no + " " + state.ward_name);
    if (state.ac) bits.push(state.ac);
    if (state.pc) bits.push(state.pc);
    if (state.pincode) bits.push("pincode " + state.pincode);
    return bits.join(" · ");
  }

  // ---------- Resolve ----------

  function resolveAllFromCache() {
    // PC / AC from pincode cache
    if (state.pincode && state.pcac_data && state.pcac_data[state.pincode]) {
      var entry = state.pcac_data[state.pincode];
      state.pc = state.pc || entry.pc;
      state.pc_code = state.pc_code || entry.pc_code || null;
      state.ac = state.ac || entry.ac;
      state.ac_code = state.ac_code || entry.ac_code || null;
    }

    // MP from cached lookup
    state.mp = (state.mps_data || []).find(function (r) { return r.pc_name === state.pc; }) || null;

    // MLA from cached lookup
    state.mla = (state.mlas_data || []).find(function (r) { return r.ac_name === state.ac; }) || null;

    // Ward from point-in-polygon
    state.ward_no = null;
    state.ward_name = null;
    if (state.lat != null && state.lng != null && state.wards_data && typeof turf !== "undefined") {
      try {
        var pt = turf.point([state.lng, state.lat]);
        for (var i = 0; i < state.wards_data.features.length; i++) {
          var feat = state.wards_data.features[i];
          if (turf.booleanPointInPolygon(pt, feat)) {
            state.ward_no = feat.properties.ward_no;
            state.ward_name = feat.properties.ward_name;
            break;
          }
        }
      } catch (err) {
        console.warn("Turf containment failed", err);
      }
    }

    // Corporator
    state.corporator = (state.corporators_data || []).find(function (r) { return r.ward_no === state.ward_no; }) || null;

    // Works in same ward
    state.works = state.ward_no
      ? (state.works_data || []).filter(function (w) { return w.ward_no === state.ward_no; })
      : [];
  }

  // ---------- Render ----------

  function render() {
    renderMap();
    renderReps();
    renderWorks();
    renderUtilities();
    renderServices();
    // Reveal sections that depend on data
    ["map-section", "reps-section", "works-section", "utilities-section", "services-section", "share-section"]
      .forEach(function (id) {
        var node = document.getElementById(id);
        if (node) node.hidden = false;
      });
  }

  var mapInstance = null;
  var mapLayerGroup = null;

  function renderMap() {
    if (state.lat == null || state.lng == null) return;
    var mapEl = $("#map");
    if (!mapEl) return;
    if (!mapInstance) {
      mapInstance = L.map(mapEl, { scrollWheelZoom: false }).setView([state.lat, state.lng], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(mapInstance);
      mapLayerGroup = L.layerGroup().addTo(mapInstance);
    } else {
      mapInstance.setView([state.lat, state.lng], 14);
    }

    // Clear previous markers/polygons
    mapLayerGroup.clearLayers();

    // User pin
    L.circleMarker([state.lat, state.lng], {
      radius: 9,
      color: "#1d4ed8",
      fillColor: "#1d4ed8",
      fillOpacity: 0.85,
      weight: 2,
    }).addTo(mapLayerGroup).bindPopup("Your pin");

    // Work pins
    (state.works || []).forEach(function (w) {
      if (w.lat && w.lng) {
        L.circleMarker([w.lat, w.lng], {
          radius: 6,
          color: "#dc2626",
          fillColor: "#dc2626",
          fillOpacity: 0.75,
          weight: 1.5,
        }).addTo(mapLayerGroup).bindPopup(
          "<strong>" + esc(w.work_name) + "</strong><br>" +
          esc(w.contractor_name || "Unknown contractor") + "<br>" +
          esc(fmtMoney(w.tender_value_cr))
        );
      }
    });

    // Highlight user's ward polygon
    if (state.ward_no && state.wards_data) {
      var feat = state.wards_data.features.find(function (f) {
        return f.properties.ward_no === state.ward_no;
      });
      if (feat) {
        L.geoJSON(feat, {
          style: { color: "#0f766e", weight: 2.5, fillOpacity: 0.08 }
        }).addTo(mapLayerGroup);
      }
    }

    // Ensure map resizes if container was hidden initially
    setTimeout(function () { mapInstance.invalidateSize(); }, 100);
  }

  function renderReps() {
    var root = $("#reps-cards");
    root.innerHTML = "";
    var cards = [];
    if (state.mp) cards.push({ kind: "mp", role: "Your MP · Lok Sabha", record: state.mp });
    if (state.mla) cards.push({ kind: "mla", role: "Your MLA · Vidhana Sabha", record: state.mla });
    if (state.corporator) cards.push({ kind: "corp", role: "Your Corporator · Ward " + (state.ward_no || "?"), record: state.corporator });

    if (!cards.length) {
      root.appendChild(el("p", { class: "status" },
        "No representative data found for this location. Try a more specific search."));
      return;
    }

    cards.forEach(function (c) { root.appendChild(buildRepCard(c)); });
  }

  function buildRepCard(c) {
    var r = c.record;
    var photo = r.mp_photo_url || r.mla_photo_url || r.corporator_photo_url || "";
    var name = r.mp_name || r.mla_name || r.corporator_name || "Unknown";
    var party = r.mp_party || r.mla_party || r.corporator_party || "—";
    var meta = r.pc_name || r.ac_name || (r.ward_name ? "Ward " + r.ward_no + " " + r.ward_name : "");
    var contact = r.mp_contact || r.mla_contact || r.corporator_mobile || "";

    var photoNode = el("div", { class: "photo", "aria-hidden": "true" });
    if (photo) {
      var img = el("img", {
        src: photo,
        alt: "",
        loading: "lazy",
        onerror: function () { this.parentNode.textContent = initials(name); }
      });
      photoNode.appendChild(img);
    } else {
      photoNode.textContent = initials(name);
    }

    var stats = el("p", { class: "stats" });
    if (c.kind === "mp") {
      stats.innerHTML =
        "<span><strong>" + esc(r.ls_attendance_pct != null ? r.ls_attendance_pct + "%" : "—") +
        "</strong> attendance</span>" +
        "<span><strong>" + esc(fmtMoney(r.mplads_allocated_cr)) +
        "</strong> MPLADS allocated</span>" +
        "<span><strong>" + esc(fmtMoney(r.mplads_spent_cr)) +
        "</strong> spent</span>";
    } else if (c.kind === "mla") {
      stats.innerHTML =
        "<span><strong>" + esc(fmtMoney(r.ac_lad_allocated_cr)) +
        "</strong> LAD allocated</span>" +
        "<span><strong>" + esc(fmtMoney(r.ac_lad_spent_cr)) +
        "</strong> spent</span>";
    } else {
      // Corporator
      if (r.ward_office_address) {
        stats.innerHTML =
          "<span><strong>Office:</strong> " + esc(r.ward_office_address) + "</span>";
      }
    }

    var info = el("div", { class: "rep-info" }, [
      el("p", { class: "role", text: c.role }),
      el("p", { class: "name", text: name }),
      el("p", { class: "meta", text: party + (meta ? " · " + meta : "") }),
      contact ? el("p", { class: "meta", text: "📞 " + contact }) : null,
      stats,
    ]);

    return el("article", { class: "card rep" }, [photoNode, info]);
  }

  function renderWorks() {
    var root = $("#works-cards");
    root.innerHTML = "";
    if (!state.works || !state.works.length) {
      var msg = state.ward_no
        ? "No bundled public works recorded for Ward " + state.ward_no + " yet."
        : "No ward identified, so no public works to show.";
      root.appendChild(el("p", { class: "status", text: msg }));
      return;
    }
    state.works.forEach(function (w) { root.appendChild(buildWorkCard(w)); });
  }

  function buildWorkCard(w) {
    var lvl = statusLevel(w);
    var header = el("div", { class: "header" }, [
      el("span", { class: "title", text: w.work_name || "Untitled work" }),
      el("span", { class: "value", text: fmtMoney(w.tender_value_cr) }),
    ]);

    var dept = el("div", { class: "dept", text:
      (w.department || "?") + " · Ward " + (w.ward_no || "?") +
      (w.ward_name ? " (" + w.ward_name + ")" : "")
    });

    var contractor = el("div", { class: "contractor", html:
      "Contractor: <strong>" + esc(w.contractor_name || "Unknown") + "</strong>"
    });

    var meta = el("div", { class: "meta", text:
      "Tender " + (w.tender_date || "?") +
      " · " + (w.completion_pct != null ? w.completion_pct + "%" : "?") + " complete"
    });

    var status = el("span", { class: "status-tag " + lvl, text: lvl.replace(/_/g, " ") });

    var children = [header, dept, contractor, meta, status];
    if (w.kppp_url) {
      children.push(el("a", {
        href: w.kppp_url,
        target: "_blank",
        rel: "noopener noreferrer",
        text: "View on kppp.karnataka.gov.in →"
      }));
    }
    return el("article", { class: "card work-card" }, children);
  }

  function renderUtilities() {
    var root = $("#utilities-tiles");
    root.innerHTML = "";
    var grid = el("div", { class: "tiles" });
    (state.utilities_data || []).forEach(function (u) {
      var node = el("a", {
        class: "tile",
        href: u.url_template,
        target: "_blank",
        rel: "noopener noreferrer",
        title: u.input_hint || u.label_en || ""
      }, [
        el("div", { class: "label", text: u.label_en || u.id }),
        el("div", { class: "hint", text: u.input_hint || "" }),
      ]);
      grid.appendChild(node);
    });
    root.appendChild(grid);
  }

  function renderServices() {
    var root = $("#services-tiles");
    root.innerHTML = "";
    var grid = el("div", { class: "tiles" });
    (state.services_data || []).forEach(function (s) {
      var node = el("a", {
        class: "tile",
        href: s.url_template,
        target: "_blank",
        rel: "noopener noreferrer",
        title: s.description || s.label_en || ""
      }, [
        el("div", { class: "label", text: s.label_en || s.id }),
        el("div", { class: "hint", text: s.description || "" }),
      ]);
      grid.appendChild(node);
    });
    root.appendChild(grid);
  }

  // ---------- Share / Maps ----------

  function initShare() {
    var shareBtn = $("#share-btn");
    var mapsBtn = $("#maps-btn");
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        if (state.lat == null || state.lng == null) return;
        var u = new URL(location.href);
        u.searchParams.set("lat", state.lat.toFixed(5));
        u.searchParams.set("lng", state.lng.toFixed(5));
        if (state.pincode) u.searchParams.set("pincode", state.pincode);
        var url = u.toString();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            setStatus("Share link copied: " + url, "success");
          }).catch(function () { prompt("Copy this URL:", url); });
        } else {
          prompt("Copy this URL:", url);
        }
      });
    }
    if (mapsBtn) {
      mapsBtn.addEventListener("click", function () {
        if (state.lat == null || state.lng == null) return;
        window.open("https://www.google.com/maps?q=" + state.lat + "," + state.lng, "_blank", "noopener,noreferrer");
      });
    }
  }

  // ---------- Bootstrap ----------

  function tryRestoreFromUrl() {
    var p = new URLSearchParams(location.search);
    var lat = parseFloat(p.get("lat"));
    var lng = parseFloat(p.get("lng"));
    var pc = p.get("pincode");
    if (!isNaN(lat) && !isNaN(lng)) {
      setStatus("Restoring shared location…");
      onCoords(lat, lng, "url", pc);
      return true;
    }
    return false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    initGps();
    initPlaceSearch();
    initPincodeSearch();
    initShare();

    loadData().then(function () {
      if (!tryRestoreFromUrl()) {
        setStatus("Ready. Tap \"Find my area\", search a place, or enter a pincode.", "success");
      }
    }).catch(function (err) {
      console.error("Data load failed", err);
      setStatus("Some data failed to load. Check console.", "error");
    });
  });
})();

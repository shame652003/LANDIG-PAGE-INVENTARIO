(function () {
    'use strict';

    const PRODUCTS_PER_PAGE = 20;
    const LS_KEY = 'repuestos_moto_ya_state';

    function loadInitialData() {
        const raw = window.INITIAL_INVENTORY_DATA;
        if (!raw || !raw.products) return { products: [], settings: {}, entradas: [] };
        const products = raw.products.filter(function (p) {
            return p.code && p.code !== 'TOTALES' && !p.code.startsWith('▼');
        });
        const settings = raw.settings || {};
        const entradas = (raw.entradas || []).filter(function (e) {
            return e.code && e.code !== 'TOTALES' && !e.code.startsWith('▼');
        });
        return { products: products, settings: settings, entradas: entradas };
    }

    var defaultSettings = {
        margen_divisas: 0.5,
        margen_bs: 0.75,
        tasa_mult: 535.9,
        tasa_div: 535.9,
        fuente_bcv: 'BCV Venezuela, 11/05/2026',
        divisor_compra: 660.0
    };

    var state = {
        products: [],
        settings: Object.assign({}, defaultSettings),
        cart: [],
        entryLog: [],
        currentTab: 'search',
        inventoryPage: 1,
        inventorySort: 'code-asc',
        inventorySearch: '',
        editingLocked: true
    };

    function saveState() {
        try {
            var toSave = {
                products: state.products,
                settings: state.settings,
                entryLog: state.entryLog
            };
            localStorage.setItem(LS_KEY, JSON.stringify(toSave));
        } catch (e) { /* ignore */ }
    }

    function loadState() {
        try {
            var saved = localStorage.getItem(LS_KEY);
            if (saved) {
                var parsed = JSON.parse(saved);
                if (parsed.products && parsed.products.length > 0) {
                    state.products = parsed.products;
                    state.settings = Object.assign({}, defaultSettings, parsed.settings || {});
                    state.entryLog = parsed.entryLog || [];
                    return true;
                }
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    function initApp() {
        if (!loadState()) {
            var initial = loadInitialData();
            state.products = initial.products;
            state.settings = Object.assign({}, defaultSettings, initial.settings);
            state.entryLog = initial.entradas || [];
        }
        state.cart = [];
        renderAll();
        bindEvents();
    }

    function calcPrices(product) {
        var s = state.settings;
        var cost = parseFloat(product.cost) || 0;
        var qty = parseFloat(product.qty) || 0;
        var override_usd = product.price_final_usd_override != null ? parseFloat(product.price_final_usd_override) : null;
        var override_bs = product.price_final_bs_override != null ? parseFloat(product.price_final_bs_override) : null;
        var costoTotal = qty * cost;
        var precioSugeridoUSD = cost * (1 + s.margen_divisas);
        var precioFinalUSD = override_usd !== null ? override_usd : precioSugeridoUSD;
        var gananciaUSD = (qty * precioFinalUSD) - costoTotal;
        var precioSugeridoBs = cost * (1 + s.margen_bs) * s.tasa_mult;
        var precioFinalBs = override_bs !== null ? override_bs : precioSugeridoBs;
        var gananciaBs = (qty * precioFinalBs) - (costoTotal * s.tasa_mult);
        var precioRefBCV = s.tasa_div ? precioFinalBs / s.tasa_div : 0;
        var precioCompraBs = s.divisor_compra ? precioFinalBs / s.divisor_compra : 0;
        return {
            costoTotal: costoTotal,
            precioSugeridoUSD: precioSugeridoUSD,
            precioFinalUSD: precioFinalUSD,
            gananciaUSD: gananciaUSD,
            precioSugeridoBs: precioSugeridoBs,
            precioFinalBs: precioFinalBs,
            gananciaBs: gananciaBs,
            precioRefBCV: precioRefBCV,
            precioCompraBs: precioCompraBs
        };
    }

    function fmt(n, decimals) {
        if (decimals === undefined) decimals = 2;
        if (n == null || isNaN(n)) return '0.00';
        return Number(n).toFixed(decimals);
    }

    function fmtMoney(n, prefix, decimals) {
        if (prefix === undefined) prefix = '';
        if (decimals === undefined) decimals = 2;
        return prefix + fmt(n, decimals);
    }

    function normalizeStr(str) {
        if (!str) return '';
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function renderAll() {
        renderRates();
        renderSearch();
        renderInventory();
        renderEntryLog();
        renderCart();
        updateCartCount();
    }

    function renderRates() {
        var s = state.settings;
        var ticker = document.getElementById('rates-ticker');
        if (!ticker) return;
        ticker.innerHTML =
            '<span class="rate-item"><span class="rate-label">Margen Divisas:</span> <span class="rate-value">' + (s.margen_divisas * 100).toFixed(1) + '%</span></span>' +
            '<span class="rate-item"><span class="rate-label">Margen Bs:</span> <span class="rate-value">' + (s.margen_bs * 100).toFixed(1) + '%</span></span>' +
            '<span class="rate-item"><span class="rate-label">Tasa Mult:</span> <span class="rate-value">' + fmt(s.tasa_mult) + ' Bs/$</span></span>' +
            '<span class="rate-item"><span class="rate-label">Tasa BCV:</span> <span class="rate-value">' + fmt(s.tasa_div) + ' Bs/$</span></span>' +
            '<span class="rate-item"><span class="rate-label">Divisor Compra:</span> <span class="rate-value">' + fmt(s.divisor_compra) + ' Bs</span></span>' +
            '<span class="rate-item"><span class="rate-label" style="font-style:italic;font-size:0.72rem;">' + escapeHtml(s.fuente_bcv || '') + '</span></span>';
    }

    function getFilteredProducts(searchTerm) {
        var term = normalizeStr(searchTerm || '').trim();
        if (!term) return state.products.filter(function (p) { return p.description && p.description.trim() !== ''; });
        return state.products.filter(function (p) {
            var code = normalizeStr(p.code);
            var desc = normalizeStr(p.description);
            return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
        });
    }

    function renderSearch() {
        var input = document.getElementById('search-input');
        var container = document.getElementById('search-results');
        var emptyEl = document.getElementById('search-empty');
        var noResultsEl = document.getElementById('search-no-results');
        var term = input ? input.value.trim() : '';
        var clearBtn = document.getElementById('search-clear');

        if (clearBtn) clearBtn.style.display = term ? 'flex' : 'none';

        if (!term) {
            container.innerHTML = '';
            container.style.display = 'none';
            emptyEl.style.display = 'flex';
            emptyEl.style.flexDirection = 'column';
            noResultsEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        var results = getFilteredProducts(term);

        if (results.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            noResultsEl.style.display = 'flex';
            noResultsEl.style.flexDirection = 'column';
            return;
        }

        noResultsEl.style.display = 'none';
        container.style.display = 'grid';
        container.innerHTML = results.map(function (p) {
            var prices = calcPrices(p);
            var qty = parseFloat(p.qty) || 0;
            var stockClass = qty <= 0 ? 'no-stock' : qty <= 3 ? 'low-stock' : 'in-stock';
            var stockLabel = qty <= 0 ? 'Agotado' : qty <= 3 ? 'Bajo stock: ' + qty : 'En stock: ' + qty;
            var inCart = state.cart.find(function (c) { return c.code === p.code; });
            var btnDisabled = qty <= 0 ? 'disabled' : '';
            var btnText = inCart ? 'En carrito' : qty <= 0 ? 'Agotado' : 'Agregar';
            return '<div class="product-card" data-code="' + escapeHtml(p.code) + '">' +
                '<div class="card-code">' + escapeHtml(p.code) + '</div>' +
                '<div class="card-desc">' + escapeHtml(p.description) + '</div>' +
                '<div class="card-stock ' + stockClass + '">' + stockLabel + '</div>' +
                '<div class="card-prices">' +
                '<div class="price-tag usd"><span class="price-label">USD</span><span class="price-value">$' + fmt(prices.precioFinalUSD) + '</span></div>' +
                '<div class="price-tag bcv"><span class="price-label">BCV $</span><span class="price-value">$' + fmt(prices.precioRefBCV) + '</span></div>' +
                '<div class="price-tag bs"><span class="price-label">Bs</span><span class="price-value">' + fmt(prices.precioFinalBs) + '</span></div>' +
                '</div>' +
                '<div class="card-actions">' +
                '<button class="btn-add-cart" ' + btnDisabled + ' data-action="add-cart" data-code="' + escapeHtml(p.code) + '">' + btnText + '</button>' +
                '</div></div>';
        }).join('');
    }

    function renderInventory() {
        var lockBtn = document.getElementById('btn-toggle-edit');
        if (lockBtn) {
            lockBtn.className = 'btn-lock ' + (state.editingLocked ? 'locked' : 'unlocked');
            lockBtn.innerHTML = state.editingLocked ? '🔒 Editar' : '🔓 Editar';
        }

        var searchTerm = document.getElementById('inv-search') ? document.getElementById('inv-search').value.trim() : '';
        var sortBy = document.getElementById('inv-sort') ? document.getElementById('inv-sort').value : 'code-asc';
        state.inventorySort = sortBy;
        state.inventorySearch = searchTerm;

        var filtered = getFilteredProducts(searchTerm);

        filtered.sort(function (a, b) {
            switch (sortBy) {
                case 'code-asc': return (a.code || '').localeCompare(b.code || '');
                case 'code-desc': return (b.code || '').localeCompare(a.code || '');
                case 'desc-asc': return (a.description || '').localeCompare(b.description || '');
                case 'qty-asc': return (parseFloat(a.qty) || 0) - (parseFloat(b.qty) || 0);
                case 'qty-desc': return (parseFloat(b.qty) || 0) - (parseFloat(a.qty) || 0);
                case 'cost-asc': return (parseFloat(a.cost) || 0) - (parseFloat(b.cost) || 0);
                case 'cost-desc': return (parseFloat(b.cost) || 0) - (parseFloat(a.cost) || 0);
                default: return 0;
            }
        });

        var totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
        if (state.inventoryPage > totalPages) state.inventoryPage = totalPages;
        var start = (state.inventoryPage - 1) * PRODUCTS_PER_PAGE;
        var page = filtered.slice(start, start + PRODUCTS_PER_PAGE);

        var tbody = document.getElementById('inventory-body');
        if (!tbody) return;

        tbody.innerHTML = page.map(function (p) {
            var prices = calcPrices(p);
            var qty = parseFloat(p.qty) || 0;
            var disabledAttr = state.editingLocked ? 'disabled' : '';
            return '<tr data-code="' + escapeHtml(p.code) + '">' +
                '<td class="code-cell">' + escapeHtml(p.code) + '</td>' +
                '<td>' + escapeHtml(p.description) + '</td>' +
                '<td class="qty-cell"><input type="number" min="0" step="1" value="' + qty + '" data-field="qty" data-code="' + escapeHtml(p.code) + '" ' + disabledAttr + '></td>' +
                '<td class="cost-cell"><input type="number" min="0" step="0.01" value="' + fmt(p.cost) + '" data-field="cost" data-code="' + escapeHtml(p.code) + '" ' + disabledAttr + '></td>' +
                '<td class="cell-usd">' + fmt(prices.precioSugeridoUSD) + '</td>' +
                '<td class="cell-usd"><input type="number" min="0" step="0.01" class="override-input" value="' + (p.price_final_usd_override != null ? fmt(p.price_final_usd_override) : '') + '" placeholder="' + fmt(prices.precioFinalUSD) + '" data-field="price_final_usd_override" data-code="' + escapeHtml(p.code) + '" style="width:70px;font-size:0.75rem;" ' + disabledAttr + '></td>' +
                '<td class="cell-usd">' + fmt(prices.gananciaUSD) + '</td>' +
                '<td class="cell-bs">' + fmt(prices.precioSugeridoBs) + '</td>' +
                '<td class="cell-bs"><input type="number" min="0" step="0.01" class="override-input" value="' + (p.price_final_bs_override != null ? fmt(p.price_final_bs_override) : '') + '" placeholder="' + fmt(prices.precioFinalBs) + '" data-field="price_final_bs_override" data-code="' + escapeHtml(p.code) + '" style="width:80px;font-size:0.75rem;" ' + disabledAttr + '></td>' +
                '<td class="cell-bs">' + fmt(prices.gananciaBs) + '</td>' +
                '<td class="cell-usd">' + fmt(prices.precioRefBCV) + '</td>' +
                '<td class="cell-bs">' + fmt(prices.precioCompraBs) + '</td>' +
                '</tr>';
        }).join('');

        renderPagination(totalPages);
    }

    function renderPagination(totalPages) {
        var container = document.getElementById('inventory-pagination');
        if (!container) return;
        if (totalPages <= 1) { container.innerHTML = ''; return; }

        var html = '';
        html += '<button data-page="prev" ' + (state.inventoryPage <= 1 ? 'disabled' : '') + '>&laquo; Anterior</button>';

        var startPage = Math.max(1, state.inventoryPage - 2);
        var endPage = Math.min(totalPages, state.inventoryPage + 2);

        if (startPage > 1) html += '<button data-page="1">1</button>';
        if (startPage > 2) html += '<span style="color:var(--text-muted);padding:0 4px;">...</span>';

        for (var i = startPage; i <= endPage; i++) {
            html += '<button data-page="' + i + '" class="' + (i === state.inventoryPage ? 'active' : '') + '">' + i + '</button>';
        }

        if (endPage < totalPages - 1) html += '<span style="color:var(--text-muted);padding:0 4px;">...</span>';
        if (endPage < totalPages) html += '<button data-page="' + totalPages + '">' + totalPages + '</button>';

        html += '<button data-page="next" ' + (state.inventoryPage >= totalPages ? 'disabled' : '') + '>Siguiente &raquo;</button>';

        container.innerHTML = html;
    }

    function renderEntryLog() {
        var container = document.getElementById('entry-log-list');
        if (!container) return;
        if (state.entryLog.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No hay entradas registradas.</p>';
            return;
        }
        var reversed = state.entryLog.slice().reverse();
        container.innerHTML = reversed.map(function (entry) {
            var statusClass = entry.status && entry.status.indexOf('Existente') !== -1 ? 'existent' : 'new';
            return '<div class="entry-log-item">' +
                '<div><strong>' + escapeHtml(entry.code) + '</strong> - ' + escapeHtml(entry.description) + '<br><small>Cant: ' + entry.qty + ' | Costo: $' + fmt(entry.cost) + '</small></div>' +
                '<span class="log-status ' + statusClass + '">' + escapeHtml(entry.status || '') + '</span>' +
                '</div>';
        }).join('');
    }

    function renderCart() {
        var itemsContainer = document.getElementById('cart-items');
        var emptyEl = document.getElementById('cart-empty');
        var footerEl = document.getElementById('cart-footer');
        var totalsEl = document.getElementById('cart-totals');
        if (!itemsContainer) return;

        if (state.cart.length === 0) {
            itemsContainer.innerHTML = '';
            emptyEl.style.display = 'block';
            footerEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        footerEl.style.display = 'block';

        itemsContainer.innerHTML = state.cart.map(function (item, idx) {
            var p = state.products.find(function (pr) { return pr.code === item.code; });
            if (!p) return '';
            var prices = calcPrices(p);
            var subtotalUSD = item.qty * prices.precioFinalUSD;
            var subtotalBs = item.qty * prices.precioFinalBs;
            var subtotalBCV = item.qty * prices.precioRefBCV;
            return '<div class="cart-item" data-index="' + idx + '">' +
                '<div class="cart-item-header">' +
                '<div><span class="cart-item-code">' + escapeHtml(p.code) + '</span></div>' +
                '<button class="cart-item-remove" data-action="remove-cart" data-index="' + idx + '">✕</button>' +
                '</div>' +
                '<div class="cart-item-desc">' + escapeHtml(p.description) + '</div>' +
                '<div class="cart-item-qty">' +
                '<button data-action="cart-minus" data-index="' + idx + '">−</button>' +
                '<span class="qty-display">' + item.qty + '</span>' +
                '<button data-action="cart-plus" data-index="' + idx + '">+</button>' +
                '</div>' +
                '<div class="cart-item-prices">' +
                '<span class="price-usd">$' + fmt(subtotalUSD) + ' USD</span>' +
                '<span class="price-bcv">$' + fmt(subtotalBCV) + ' BCV</span>' +
                '<span class="price-bs">' + fmt(subtotalBs) + ' Bs</span>' +
                '</div></div>';
        }).join('');

        var totalUSD = 0;
        var totalBs = 0;
        var totalBCV = 0;
        state.cart.forEach(function (item) {
            var p = state.products.find(function (pr) { return pr.code === item.code; });
            if (p) {
                var prices = calcPrices(p);
                totalUSD += item.qty * prices.precioFinalUSD;
                totalBs += item.qty * prices.precioFinalBs;
                totalBCV += item.qty * prices.precioRefBCV;
            }
        });

        totalsEl.innerHTML =
            '<div class="cart-total-row"><span>Subtotal USD:</span><span>$' + fmt(totalUSD) + '</span></div>' +
            '<div class="cart-total-row"><span>Subtotal BCV $:</span><span>$' + fmt(totalBCV) + '</span></div>' +
            '<div class="cart-total-row"><span>Subtotal Bs:</span><span>' + fmt(totalBs) + '</span></div>' +
            '<div class="cart-total-row grand"><span>TOTAL USD:</span><span>$' + fmt(totalUSD) + '</span></div>' +
            '<div class="cart-total-row grand"><span>TOTAL BCV $:</span><span>$' + fmt(totalBCV) + '</span></div>' +
            '<div class="cart-total-row grand"><span>TOTAL Bs:</span><span>' + fmt(totalBs) + '</span></div>';
    }

    function updateCartCount() {
        var count = state.cart.reduce(function (sum, item) { return sum + item.qty; }, 0);
        var headerBadge = document.getElementById('cart-count-header');
        var fabBadge = document.getElementById('cart-count-fab');
        if (headerBadge) headerBadge.textContent = count;
        if (fabBadge) fabBadge.textContent = count;
    }

    function addToCart(code) {
        var p = state.products.find(function (pr) { return pr.code === code; });
        if (!p) return;
        var qty = parseFloat(p.qty) || 0;
        if (qty <= 0) return;

        var existing = state.cart.find(function (c) { return c.code === code; });
        if (existing) {
            if (existing.qty < qty) {
                existing.qty++;
                showToast('Cantidad actualizada en el carrito', 'success');
            } else {
                showToast('Stock insuficiente', 'error');
            }
        } else {
            state.cart.push({ code: code, qty: 1 });
            showToast('Producto agregado al carrito', 'success');
        }
        renderCart();
        updateCartCount();
        renderSearch();
    }

    function removeFromCart(index) {
        state.cart.splice(index, 1);
        renderCart();
        updateCartCount();
        renderSearch();
    }

    function changeCartQty(index, delta) {
        var item = state.cart[index];
        if (!item) return;
        var p = state.products.find(function (pr) { return pr.code === item.code; });
        if (!p) return;
        var maxQty = parseFloat(p.qty) || 0;
        var newQty = item.qty + delta;
        if (newQty <= 0) {
            removeFromCart(index);
            return;
        }
        if (newQty > maxQty) {
            showToast('Stock insuficiente (disponible: ' + maxQty + ')', 'error');
            return;
        }
        item.qty = newQty;
        renderCart();
        updateCartCount();
    }

    function processCart() {
        if (state.cart.length === 0) {
            showToast('El carrito está vacío', 'error');
            return;
        }
        var errors = [];
        state.cart.forEach(function (item) {
            var p = state.products.find(function (pr) { return pr.code === item.code; });
            if (!p) { errors.push('Producto ' + item.code + ' no encontrado'); return; }
            var currentQty = parseFloat(p.qty) || 0;
            if (item.qty > currentQty) {
                errors.push(p.description + ': stock insuficiente');
            }
        });
        if (errors.length > 0) {
            showToast('Error: ' + errors[0], 'error');
            return;
        }

        state.cart.forEach(function (item) {
            var p = state.products.find(function (pr) { return pr.code === item.code; });
            if (p) {
                p.qty = Math.max(0, (parseFloat(p.qty) || 0) - item.qty);
            }
        });

        state.cart = [];
        saveState();
        renderCart();
        updateCartCount();
        renderSearch();
        renderInventory();
        showToast('Despacho procesado correctamente. Stock actualizado.', 'success');
    }

    function printCart() {
        if (state.cart.length === 0) {
            showToast('El carrito está vacío', 'error');
            return;
        }

        var printArea = document.getElementById('print-area');
        var s = state.settings;
        var rows = '';
        var totalUSD = 0;
        var totalBs = 0;
        var totalBCV = 0;

        state.cart.forEach(function (item) {
            var p = state.products.find(function (pr) { return pr.code === item.code; });
            if (!p) return;
            var prices = calcPrices(p);
            var subtotalUSD = item.qty * prices.precioFinalUSD;
            var subtotalBs = item.qty * prices.precioFinalBs;
            var subtotalBCV = item.qty * prices.precioRefBCV;
            totalUSD += subtotalUSD;
            totalBs += subtotalBs;
            totalBCV += subtotalBCV;
            rows += '<tr><td>' + escapeHtml(p.code) + '</td><td>' + escapeHtml(p.description) + '</td><td>' + item.qty + '</td><td>' + fmt(prices.precioFinalUSD) + '</td><td>' + fmt(prices.precioFinalBs) + '</td><td>' + fmt(prices.precioRefBCV) + '</td><td>' + fmt(subtotalUSD) + '</td><td>' + fmt(subtotalBs) + '</td><td>' + fmt(subtotalBCV) + '</td></tr>';
        });

        printArea.innerHTML =
            '<div class="print-header"><h1>Repuestos de Moto Y.A - Presupuesto</h1>' +
            '<p>Fecha: ' + new Date().toLocaleDateString('es-VE') + ' | Tasa BCV: ' + fmt(s.tasa_div) + ' Bs/$ | Tasa Mult: ' + fmt(s.tasa_mult) + ' Bs/$</p></div>' +
            '<table><thead><tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>P.Unit. $</th><th>P.Unit. Bs</th><th>P.BCV $</th><th>Subtotal $</th><th>Subtotal Bs</th><th>Subtotal BCV $</th></tr></thead><tbody>' + rows + '</tbody></table>' +
            '<div class="print-totals"><p>TOTAL USD: $' + fmt(totalUSD) + '</p><p>TOTAL BCV $: $' + fmt(totalBCV) + '</p><p>TOTAL Bs: ' + fmt(totalBs) + '</p></div>' +
            '<div class="print-footer">Generado por Repuestos de Moto Y.A | ' + new Date().toLocaleString('es-VE') + '</div>';

        window.print();
    }

    function openCart() {
        document.getElementById('cart-panel').classList.add('open');
        document.getElementById('cart-overlay').classList.add('visible');
    }

    function closeCart() {
        document.getElementById('cart-panel').classList.remove('open');
        document.getElementById('cart-overlay').classList.remove('visible');
    }

    function addEntry(code, description, qty, cost) {
        var existing = state.products.find(function (p) { return p.code === code; });
        var logEntry = {
            code: code,
            description: description,
            qty: qty,
            cost: cost,
            date: new Date().toISOString(),
            status: ''
        };

        if (existing) {
            existing.qty = (parseFloat(existing.qty) || 0) + qty;
            if (cost > 0) existing.cost = cost;
            logEntry.status = '\u2705 Existente \u2013 cantidad sumada';
        } else {
            state.products.push({
                code: code,
                description: description,
                qty: qty,
                cost: cost,
                price_final_usd_override: null,
                price_final_bs_override: null,
                precio_italia: ''
            });
            logEntry.status = '\u2705 Nuevo producto agregado';
        }

        state.entryLog.push(logEntry);
        saveState();
        renderAll();
        showToast(logEntry.status, 'success');
    }

    function toggleEditing() {
        state.editingLocked = !state.editingLocked;
        renderInventory();
        showToast(state.editingLocked ? 'Edición bloqueada' : 'Edición habilitada', 'info');
    }

    function openRateModal() {
        var s = state.settings;
        document.getElementById('rate-margen-divisas').value = (s.margen_divisas * 100).toFixed(1);
        document.getElementById('rate-margen-bs').value = (s.margen_bs * 100).toFixed(1);
        document.getElementById('rate-tasa-mult').value = s.tasa_mult;
        document.getElementById('rate-tasa-div').value = s.tasa_div;
        document.getElementById('rate-divisor-compra').value = s.divisor_compra;
        document.getElementById('rate-fuente-bcv').value = s.fuente_bcv || '';
        document.getElementById('rate-modal').classList.add('visible');
    }

    function closeRateModal() {
        document.getElementById('rate-modal').classList.remove('visible');
    }

    function saveRates() {
        var s = state.settings;
        s.margen_divisas = parseFloat(document.getElementById('rate-margen-divisas').value) / 100;
        s.margen_bs = parseFloat(document.getElementById('rate-margen-bs').value) / 100;
        s.tasa_mult = parseFloat(document.getElementById('rate-tasa-mult').value);
        s.tasa_div = parseFloat(document.getElementById('rate-tasa-div').value);
        s.divisor_compra = parseFloat(document.getElementById('rate-divisor-compra').value);
        s.fuente_bcv = document.getElementById('rate-fuente-bcv').value;
        saveState();
        closeRateModal();
        renderAll();
        showToast('Tasas actualizadas. Todos los precios recalculados.', 'success');
    }

    function exportBackup() {
        var data = {
            products: state.products,
            settings: state.settings,
            entryLog: state.entryLog,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'INVENMAX_backup_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Backup exportado correctamente', 'success');
    }

    function importBackup(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var data = JSON.parse(e.target.result);
                if (!data.products || !Array.isArray(data.products)) {
                    throw new Error('Formato de backup inv\u00e1lido');
                }
                state.products = data.products;
                state.settings = Object.assign({}, defaultSettings, data.settings || {});
                state.entryLog = data.entryLog || [];
                saveState();
                renderAll();
                showToast('Backup importado correctamente. ' + data.products.length + ' productos cargados.', 'success');
            } catch (err) {
                showToast('Error al importar: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    }

    function showToast(message, type) {
        var container = document.getElementById('toast-container');
        var toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'info');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3200);
    }

    function switchTab(tabName) {
        state.currentTab = tabName;
        document.querySelectorAll('.nav-tab').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(function (sec) {
            sec.classList.toggle('active', sec.id === 'tab-' + tabName);
        });
        if (tabName === 'inventory') renderInventory();
        if (tabName === 'search') renderSearch();
    }

    function handleInventoryEdit(e) {
        var target = e.target;
        if (!target.matches || !target.matches('input[data-field][data-code]')) return;
        var field = target.getAttribute('data-field');
        var code = target.getAttribute('data-code');
        var value = target.value.trim();

        var product = state.products.find(function (p) { return p.code === code; });
        if (!product) return;

        if (field === 'qty') {
            product.qty = parseFloat(value) || 0;
        } else if (field === 'cost') {
            product.cost = parseFloat(value) || 0;
        } else if (field === 'price_final_usd_override') {
            product.price_final_usd_override = value === '' ? null : parseFloat(value);
        } else if (field === 'price_final_bs_override') {
            product.price_final_bs_override = value === '' ? null : parseFloat(value);
        }

        saveState();
        renderInventory();
        renderSearch();
    }

    function handleSearchClick(e) {
        var btn = e.target.closest('[data-action="add-cart"]');
        if (btn) {
            addToCart(btn.getAttribute('data-code'));
        }
    }

    function handleCartClick(e) {
        var action = e.target.closest('[data-action]');
        if (!action) return;
        var act = action.getAttribute('data-action');
        var idx = parseInt(action.getAttribute('data-index'), 10);

        if (act === 'remove-cart') {
            removeFromCart(idx);
        } else if (act === 'cart-plus') {
            changeCartQty(idx, 1);
        } else if (act === 'cart-minus') {
            changeCartQty(idx, -1);
        }
    }

    function handlePaginationClick(e) {
        var btn = e.target.closest('[data-page]');
        if (!btn) return;
        var page = btn.getAttribute('data-page');
        if (page === 'prev') {
            state.inventoryPage = Math.max(1, state.inventoryPage - 1);
        } else if (page === 'next') {
            state.inventoryPage++;
        } else {
            state.inventoryPage = parseInt(page, 10);
        }
        renderInventory();
    }

    function bindEvents() {
        document.querySelectorAll('.nav-tab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchTab(btn.getAttribute('data-tab'));
            });
        });

        var searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                renderSearch();
            });
        }

        var searchClear = document.getElementById('search-clear');
        if (searchClear) {
            searchClear.addEventListener('click', function () {
                searchInput.value = '';
                renderSearch();
                searchInput.focus();
            });
        }

        document.getElementById('search-results').addEventListener('click', handleSearchClick);

        var invSearch = document.getElementById('inv-search');
        if (invSearch) {
            invSearch.addEventListener('input', function () {
                state.inventoryPage = 1;
                renderInventory();
            });
        }

        var invSort = document.getElementById('inv-sort');
        if (invSort) {
            invSort.addEventListener('change', function () {
                state.inventoryPage = 1;
                renderInventory();
            });
        }

        document.getElementById('inventory-body').addEventListener('change', handleInventoryEdit);

        document.getElementById('inventory-pagination').addEventListener('click', handlePaginationClick);

        var toggleBtn = document.getElementById('btn-toggle-edit');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleEditing);
        }

        document.getElementById('entry-form').addEventListener('submit', function (e) {
            e.preventDefault();
            var code = document.getElementById('entry-code').value.trim().toUpperCase();
            var desc = document.getElementById('entry-desc').value.trim();
            var qty = parseFloat(document.getElementById('entry-qty').value) || 0;
            var cost = parseFloat(document.getElementById('entry-cost').value) || 0;

            if (!code || !desc || qty <= 0) {
                showToast('Complete todos los campos correctamente', 'error');
                return;
            }

            var existing = state.products.find(function (p) { return p.code === code; });
            if (existing) {
                document.getElementById('entry-desc').value = existing.description;
                desc = existing.description;
            }

            addEntry(code, desc, qty, cost);
            document.getElementById('entry-form').reset();
            document.getElementById('entry-code').focus();
        });

        document.getElementById('entry-code').addEventListener('input', function () {
            var code = this.value.trim().toUpperCase();
            if (code.length >= 3) {
                var existing = state.products.find(function (p) { return p.code === code; });
                if (existing) {
                    document.getElementById('entry-desc').value = existing.description;
                    document.getElementById('entry-cost').value = existing.cost;
                }
            }
        });

        document.getElementById('btn-edit-rates').addEventListener('click', openRateModal);
        document.getElementById('rate-cancel').addEventListener('click', closeRateModal);
        document.getElementById('rate-save').addEventListener('click', saveRates);
        document.getElementById('rate-modal').querySelector('.modal-overlay').addEventListener('click', closeRateModal);

        document.getElementById('btn-cart-open').addEventListener('click', openCart);
        document.getElementById('cart-fab').addEventListener('click', openCart);
        document.getElementById('cart-close').addEventListener('click', closeCart);
        document.getElementById('cart-overlay').addEventListener('click', closeCart);

        document.getElementById('cart-items').addEventListener('click', handleCartClick);

        document.getElementById('cart-process').addEventListener('click', processCart);
        document.getElementById('cart-print').addEventListener('click', printCart);
        document.getElementById('cart-clear').addEventListener('click', function () {
            if (state.cart.length === 0) return;
            state.cart = [];
            renderCart();
            updateCartCount();
            renderSearch();
            showToast('Carrito vaciado', 'info');
        });

        document.getElementById('btn-export').addEventListener('click', exportBackup);
        document.getElementById('btn-import-file').addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                importBackup(e.target.files[0]);
                e.target.value = '';
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeRateModal();
                closeCart();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', initApp);
})();
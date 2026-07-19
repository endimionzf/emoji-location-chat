let allEmojis = [];
let filteredEmojis = [];
let searchResults = null; // will be Map(id -> score) when active
let viewMode = '2d'; // '2d' or '3d'
let selectedCategory = 'ALL';

// DOM Elements
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const totalPointsEl = document.getElementById('totalPoints');
const categorySelect = document.getElementById('categorySelect');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const inspectorBody = document.getElementById('inspectorBody');
const chartEl = document.getElementById('plotlyChart');

// Color Palette for categories
const CATEGORY_COLORS = {
  'Smileys & Emotion': '#f59e0b', // Amber
  'People & Body': '#ec4899',     // Pink
  'Animals & Nature': '#10b981',  // Emerald
  'Food & Drink': '#ef4444',      // Red
  'Travel & Places': '#8b5cf6',   // Purple
  'Activities': '#06b6d4',        // Cyan
  'Objects': '#6366f1',           // Indigo
  'Symbols': '#3b82f6',           // Blue
  'Flags': '#14b8a6',             // Teal
  'Uncategorized': '#64748b'      // Slate
};

// Default fallbacks
const DEFAULT_COLOR = '#64748b';

// On Load
window.addEventListener('DOMContentLoaded', () => {
  fetchEmojis();
});

// Fetch emoji data from API
async function fetchEmojis() {
  try {
    const res = await fetch('/api/emojis');
    const json = await res.json();
    if (json.status === 'success') {
      allEmojis = json.data;
      filteredEmojis = [...allEmojis];
      totalPointsEl.textContent = allEmojis.length;
      
      // Populate categories
      const categories = [...new Set(allEmojis.map(e => e.category))].sort();
      categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
      });

      // Hide loading and render
      loadingOverlay.classList.add('hidden');
      renderChart();
    } else {
      loadingText.textContent = 'Error loading data: ' + json.message;
    }
  } catch (err) {
    loadingText.textContent = 'Failed to fetch emojis: ' + err.message;
  }
}

// Switch between 2D and 3D
function switchView(mode) {
  if (viewMode === mode) return;
  viewMode = mode;
  
  document.getElementById('btn2D').classList.toggle('active', mode === '2d');
  document.getElementById('btn3D').classList.toggle('active', mode === '3d');
  
  renderChart();
}

// Apply Category & Search Filters
function applyFilters() {
  selectedCategory = categorySelect.value;
  
  filteredEmojis = allEmojis.filter(emoji => {
    // Category match
    const categoryMatch = (selectedCategory === 'ALL' || emoji.category === selectedCategory);
    
    // Search match: if search is active, only show items that are returned by search
    const searchMatch = !searchResults || searchResults.has(emoji.id);
    
    return categoryMatch && searchMatch;
  });

  renderChart();
}

// Handle semantic vector search
async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  loadingOverlay.classList.remove('hidden');
  loadingText.textContent = `Searching vector space for "${query}"...`;

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, limit: 100 }) // top 100 matches
    });
    
    const json = await res.json();
    loadingOverlay.classList.add('hidden');

    if (json.status === 'success') {
      const results = json.results;
      searchResults = new Map(results.map(r => [r.id, r.score]));
      clearSearchBtn.classList.remove('hidden');
      
      // Highlight the first search result in the inspector
      if (results.length > 0) {
        updateInspector(results[0], results[0].score);
      }
      
      applyFilters();
    } else {
      alert('Search failed: ' + json.message);
    }
  } catch (err) {
    loadingOverlay.classList.add('hidden');
    alert('Failed to search: ' + err.message);
  }
}

// Reset search state
function resetSearch() {
  searchResults = null;
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  
  // Reset inspector
  inspectorBody.innerHTML = `<div class="empty-state">Click or hover over any point in the plot to inspect emoji details.</div>`;
  
  applyFilters();
}

// Update Emoji Inspector Panel
function updateInspector(emoji, score = null) {
  const imgUrl = `/images/${emoji.image_file}`;
  
  let scoreHtml = '';
  if (score !== null) {
    scoreHtml = `
      <div class="meta-row">
        <span class="meta-label">Similarity Score</span>
        <span class="meta-val" style="color: var(--accent-color); font-weight: bold;">${score.toFixed(4)}</span>
      </div>
    `;
  }

  inspectorBody.innerHTML = `
    <div class="inspector-detail">
      <img src="${imgUrl}" class="inspector-img" alt="${emoji.name}" />
      <div class="inspector-name">${emoji.name}</div>
      <div class="inspector-metadata">
        <div class="meta-row">
          <span class="meta-label">Short Name</span>
          <span class="meta-val">:${emoji.short_name}:</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Category</span>
          <span class="meta-val">${emoji.category}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Subcategory</span>
          <span class="meta-val">${emoji.subcategory || 'N/A'}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Unified Hex</span>
          <span class="meta-val">${emoji.unified || 'N/A'}</span>
        </div>
        ${scoreHtml}
        <div class="meta-row">
          <span class="meta-label">UMAP Coords</span>
          <span class="meta-val">${emoji.x_2d.toFixed(2)}, ${emoji.y_2d.toFixed(2)}</span>
        </div>
      </div>
    </div>
  `;
}

// Render Plotly Chart
function renderChart() {
  // Group by category to build traces
  const categoryGroups = {};
  
  filteredEmojis.forEach(emoji => {
    const cat = emoji.category;
    if (!categoryGroups[cat]) {
      categoryGroups[cat] = [];
    }
    categoryGroups[cat].push(emoji);
  });

  const traces = [];

  // Create trace for each category
  Object.keys(categoryGroups).forEach(cat => {
    const list = categoryGroups[cat];
    const color = CATEGORY_COLORS[cat] || DEFAULT_COLOR;
    
    // For scatter plots, set custom sizes depending on search state
    const sizes = list.map(e => {
      if (searchResults) {
        // If it's a search result, make it large; otherwise small
        return searchResults.has(e.id) ? 14 : 4;
      }
      return 6; // Default size
    });

    const opacities = list.map(e => {
      if (searchResults) {
        return searchResults.has(e.id) ? 1.0 : 0.25;
      }
      return 0.75;
    });

    const textLabels = list.map(e => `:${e.short_name}:<br>${e.name}<br>${e.category}`);

    if (viewMode === '2d') {
      traces.push({
        x: list.map(e => e.x_2d),
        y: list.map(e => e.y_2d),
        text: textLabels,
        mode: 'markers',
        type: 'scatter',
        name: cat,
        customdata: list,
        marker: {
          size: sizes,
          color: color,
          opacity: opacities,
          line: {
            color: '#0f172a',
            width: searchResults ? 1.5 : 0.5
          }
        }
      });
    } else {
      // 3D mode
      traces.push({
        x: list.map(e => e.x_3d),
        y: list.map(e => e.y_3d),
        z: list.map(e => e.z_3d),
        text: textLabels,
        mode: 'markers',
        type: 'scatter3d',
        name: cat,
        customdata: list,
        marker: {
          size: sizes.map(s => s * 0.8), // Slightly smaller markers for 3D
          color: color,
          opacity: opacities,
          line: {
            color: '#0f172a',
            width: 0.5
          }
        }
      });
    }
  });

  // Dark slate layout
  const layout = {
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    margin: { l: 0, r: 0, t: 30, b: 0 },
    showlegend: true,
    legend: {
      font: { color: '#94a3b8', size: 10 },
      bgcolor: 'rgba(15, 23, 42, 0.8)',
      bordercolor: '#334155',
      borderwidth: 1,
      x: 0.02,
      y: 0.98,
      xanchor: 'left',
      yanchor: 'top'
    },
    hoverlabel: {
      bgcolor: '#1e293b',
      bordercolor: '#334155',
      font: { color: '#f8fafc', size: 12, family: 'Inter, sans-serif' }
    }
  };

  if (viewMode === '2d') {
    layout.xaxis = {
      gridcolor: '#1e293b',
      zerolinecolor: '#334155',
      tickfont: { color: '#64748b' }
    };
    layout.yaxis = {
      gridcolor: '#1e293b',
      zerolinecolor: '#334155',
      tickfont: { color: '#64748b' }
    };
  } else {
    // 3D layout axes
    layout.scene = {
      xaxis: {
        gridcolor: '#1e293b',
        backgroundcolor: '#0f172a',
        showbackground: true,
        tickfont: { color: '#64748b' }
      },
      yaxis: {
        gridcolor: '#1e293b',
        backgroundcolor: '#0f172a',
        showbackground: true,
        tickfont: { color: '#64748b' }
      },
      zaxis: {
        gridcolor: '#1e293b',
        backgroundcolor: '#0f172a',
        showbackground: true,
        tickfont: { color: '#64748b' }
      }
    };
  }

  const config = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d']
  };

  Plotly.newPlot(chartEl, traces, layout, config);

  // Hover/Click handlers
  chartEl.on('plotly_click', function(data) {
    if (data.points && data.points.length > 0) {
      const pt = data.points[0];
      if (pt.customdata) {
        const item = pt.customdata;
        const score = searchResults ? searchResults.get(item.id) : null;
        updateInspector(item, score);
      }
    }
  });

  chartEl.on('plotly_hover', function(data) {
    if (data.points && data.points.length > 0) {
      const pt = data.points[0];
      if (pt.customdata) {
        const item = pt.customdata;
        const score = searchResults ? searchResults.get(item.id) : null;
        updateInspector(item, score);
      }
    }
  });
}

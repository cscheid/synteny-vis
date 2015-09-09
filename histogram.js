'use strict';

var HISTOGRAM_MARGIN = 50; /* Padding around histogram */
var HISTOGRAM_Y_SCALE_TRANS_LEN = 750; /* How long a y-axis histogram rescale takes */
var HISTOGRAM_COLOR_TRANS_LEN = 500; /* How long a color scale transition takes */
var NUM_HISTOGRAM_TICKS = 100;
var UNSELECTED_BAR_FILL = '#D0D0D0';

var SHOW_MAXIMA = true;
var SHOW_MINIMA = true;

var REFRESH_Y_SCALE_ON_BRUSH_PAUSE = false;

function histogram(id, dataObj, field, initialColorScale) {
  var dataExtent = d3.extent(_.pluck(dataObj.currentData().raw, field));

  var plot = d3.select(id);
  var plotWidth = getComputedAttr(plot.node(), 'width');
  var plotHeight = getComputedAttr(plot.node(), 'height');

  var prettyNames = {
    logks: 'log(ks)',
    logkn: 'log(kn)',
    logkskn: 'log(ks/kn)'
  };
  plot.append('text')
    .attr('x', 2 * plotHeight / 3)
    .attr('width', plotHeight / 3)
    .attr('y', 50)
    .attr('height', 50)
    .classed('histogram-title', true)
    .text(prettyNames[field]);

  function plotBrushBrush() {
    if (!plotBrush.empty()) {
      dataObj.addDataFilter(plotBrush.extent(), field);
    }
  }

  function plotBrushEnd() {
    if (plotBrush.empty()) {
      dataObj.removeDataFilter(field);
    } else {
      dataObj.addDataFilter(plotBrush.extent(), field, 
        REFRESH_Y_SCALE_ON_BRUSH_PAUSE ? 'data-stop' : null);
    }
  }

  var colorScale = initialColorScale;
  var xPlotScale = d3.scale.linear().domain(dataExtent).range([HISTOGRAM_MARGIN, plotWidth - HISTOGRAM_MARGIN]);

  function makeBins() {
    var data = _.chain(dataObj.currentData().raw).pluck(field).sortBy().value();
    //var n = Math.floor(Math.sqrt(data.length));
    //var n = 2 * Math.floor(Math.pow(data.length, 1/3));
    var n = NUM_HISTOGRAM_TICKS;
    var min = dataExtent[0];
    var max = dataExtent[1];
    var range = max - min;
    var step = range / n;
    return _.range(min, max, step);
  }

  var bins = makeBins();
  var lastYExtent = [0, 3 / 2 * d3.max(_.pluck(dataObj.currentDataSummary(bins, field), 'y'))];

  var yPlotScale = d3.scale.linear().domain(lastYExtent).range([plotHeight - HISTOGRAM_MARGIN, HISTOGRAM_MARGIN]);

  var autoScale;

  function getAutoScale() {
    return autoScale;
  }

  function generateAutoScale(summary, persistence) {

    function removeNonExtrema(A) {
      return _.filter(A, function(p, i, a) {
        return i === 0 || i === a.length - 1 ||
          (a[i - 1].y - a[i].y) * (a[i].y - a[i + 1].y) < 0;
      });
    }

    function edgeDelta(A, e) {
      return Math.abs(A[e[0]].y - A[e[1]].y);
    }

    function minimumDeltaEdge(A) {
      var edges = _.zip(_.range(0, A.length - 1), _.range(1, A.length));
      return _.min(edges, _.partial(edgeDelta, A));
    }

    var mm = removeNonExtrema(summary);
    while (edgeDelta(mm, minimumDeltaEdge(mm)) < persistence) {
      var e = minimumDeltaEdge(mm);
      if (e[0] === 0) {
        if (mm.length <= 3) break;
        mm.splice(1, 1);
      } else if (e[1] === mm.length - 1) {
        if (mm.length <= 3) break;
        mm.splice(mm.length - 2, 1);
      } else {
        if (mm.length <= 4) break;
        mm.splice(e[0], 1);
      }
      mm = removeNonExtrema(mm);
    }

    mm = _.partition(mm, function(p, i, a) {
      return i === 0 || i === a.length - 1 ||
        p.y > a[i - 1].y || p.y > a[i + 1].y;
    });

    var maxima = mm[0];
    var minima = mm[1];

    if (maxima.length > 3) {
      maxima = _.chain(maxima).initial().rest().value();
    }

    _.each(maxima, function(m) {
      _.defaults(m, {
        max: true
      });
    });
    _.each(minima, function(m) {
      _.defaults(m, {
        max: false
      });
    });

    if (SHOW_MAXIMA || SHOW_MINIMA) {
      var tempSelA = plot.selectAll('.maxMark').data(maxima.concat(minima));
      tempSelA.exit().remove();
      tempSelA.enter().append('circle').classed('maxMark', 1);
      tempSelA
        .attr('cx', function(d) {
          return xPlotScale(d.x + d.dx / 2);
        })
        .attr('cy', function(d) {
          return yPlotScale(d.y) - 5;
        })
        .attr('r', 3)
        .attr('fill', function(d) {
          return d.max ? 'red' : 'orange';
        })
        .attr('opacity', function(d) {
          return ((d.max && SHOW_MAXIMA) || (!d.max && SHOW_MINIMA)) ? 1 : 0;
        });
    }

    _.each(maxima, function(m, i) {
      m.colorIndex = i;
    });

    var combined = _.sortBy(minima.concat(maxima), 'x');

    var colors = d3.scale.category10();
    autoScale = d3.scale.linear()
      .domain(_.map(combined, function(d) {
        return d.x + d.dx / 2
      }))
      .range(_.chain(combined).map(function(m) {
        return m.max ? colors(m.colorIndex) : UNSELECTED_BAR_FILL;
      }).value());
  }

  var plotBrush = d3.svg.brush()
    .x(xPlotScale)
    .on('brush', plotBrushBrush)
    .on('brushend', plotBrushEnd);

  plot.selectAll('.dataBars')
    .data(bins)
    .enter()
    .append('rect').classed('dataBars', true);

  plot.append('g').attr('id', 'plotbrush-group')
    .attr('transform', translate(0, HISTOGRAM_MARGIN))
    .call(plotBrush)
    .selectAll('rect').attr('height', plotHeight - 2 * HISTOGRAM_MARGIN);


  var xAxis = d3.svg.axis().scale(xPlotScale).orient('bottom').tickSize(10);
  var yAxis = d3.svg.axis().scale(yPlotScale).orient('left').ticks(5);

  plot.append('g')
    .attr('transform', translate(0, plotHeight - HISTOGRAM_MARGIN))
    .classed('xAxis', true).call(xAxis);
  var yAxisSel = plot.append('g')
    .attr('transform', translate(HISTOGRAM_MARGIN, 0))
    .classed('yAxis', true).call(yAxis);

  function updatePlotAttrs(selection) {
    var activeFunc = plotBrush.empty() ? _.constant(true) : function(bin) {
      return bin.x + bin.dx > plotBrush.extent()[0] &&
        bin.x < plotBrush.extent()[1];
    };
    selection
      .attr('x', function(d) {
        return xPlotScale(d.x);
      })
      .attr('width', function(d) {
        return (xPlotScale(d.x + d.dx) - xPlotScale(d.x));
      })
      .attr('y', function(d) {
        return yPlotScale(d.y);
      })
      .attr('height', function(d) {
        return plotHeight - HISTOGRAM_MARGIN - yPlotScale(d.y);
      })
      .attr('fill', function(d) {
        return activeFunc(d) ? colorScale(d.x + d.dx / 2) : 'grey';
      });
  }

  function updatePlot(typeHint) {

    typeHint = typeHint || '';
    var data = dataObj.currentDataSummary(bins, field);
    generateAutoScale(data, getPersistence());
    plot.selectAll('.dataBars')
      .data(data)
      .call(updatePlotAttrs);

    if (typeHint.indexOf('spatial-stop') >= 0 || typeHint === 'data-stop') {
      lastYExtent = [0, 3 / 2 * d3.max(_.pluck(data, 'y'))];
      yPlotScale.domain(lastYExtent);
      yAxisSel.transition()
        .duration(HISTOGRAM_Y_SCALE_TRANS_LEN)
        .call(yAxis);
      plot.selectAll('.dataBars')
        .data(data)
        .transition()
        .duration(HISTOGRAM_Y_SCALE_TRANS_LEN)
        .call(updatePlotAttrs);

      plot.selectAll('.maxMark')
        .transition().duration(HISTOGRAM_Y_SCALE_TRANS_LEN)
        .attr('cy', function(d) {
          return yPlotScale(d.y) - 5;
        });
    } else {
      // To disable sharp transitions, move that chunk above down here. 
    }
  }

  updatePlot('initial');
  dataObj.addListener(updatePlot);

  function setColorScale(newColorScale) {
    colorScale = newColorScale;
    plot.selectAll('.dataBars')
      .transition().duration(HISTOGRAM_COLOR_TRANS_LEN)
      .call(updatePlotAttrs);
  }
  return {
    setColorScale: setColorScale,
    getAutoScale: getAutoScale,
    refreshAutoScale: updatePlot
  };
}



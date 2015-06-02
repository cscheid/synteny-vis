function cumulative_counts(data) {
  var ret = [];
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    ret[i] = count;
    count += data[i];
  }
  ret[i] = count;
  return ret;
}

var q = queue();

switch (window.location.hash) {
  case '#homo_chimp':
  case '#h':
    q = q.defer(d3.json, 'data/homo_chimp.json')
      .defer(d3.json, 'lengths/11691.json')
      .defer(d3.json, 'lengths/25577.json');
    break;
  case '#ecoli':
  case '#e':
    q = q.defer(d3.json, 'data/ecoli.json')
      .defer(d3.json, 'lengths/4241.json')
      .defer(d3.json, 'lengths/4242.json');
    break;
  case '#arabidopsis':
  case '#a':
    q = q.defer(d3.json, 'data/arabidopsis.json')
      .defer(d3.json, 'lengths/16911.json')
      .defer(d3.json, 'lengths/3068.json');
    break;
  case '#maize_sorghum':
  case '#m':
    q = q.defer(d3.json, 'data/maize_sorghum.json')
      .defer(d3.json, 'lengths/6807.json')
      .defer(d3.json, 'lengths/8082.json');
    break;
  default:
    alert("Don't know what '" + window.location.hash + "' is. Loading homo_chimp.json");
    q = q.defer(d3.json, 'data/homo_chimp.json')
      .defer(d3.json, 'lengths/11691.json')
      .defer(d3.json, 'lengths/25577.json');
}

q.await(function(error, data, aLengths, bLengths) {
  if (error) {
    console.log(error);
    return;
  }

  //Make sure we gave the length files in the right order.
  var aID = data[0].header.aID_c.split('_')[0];
  aID = aID.substring(1, aID.length);
  var bID = data[0].header.bID_c.split('_')[0];
  bID = bID.substring(1, bID.length);
  if (aID !== aLengths.id) {
    console.log('You got the length files backwards, swapping...');
    var t = aLengths;
    aLengths = bLengths;
    bLengths = t;
  }
  if (aID !== aLengths.id || bID !== bLengths.id) {
    console.log('Are you using the right length files?');
    console.log('Length files have ID\'s: ' + aLengths.id +
      ' and ' + bLengths.id);
    console.log('Data file has ID\'s: ' + aID + ' and ' + bID);
    return;
  }

  // Compute cumulative BP counts
  var xLengths = _.map(aLengths.lengths, function(d) {
    return {
      name: d.name,
      length: Number(d.length)
    };
  });

  var yLengths = _.map(bLengths.lengths, function(d) {
    return {
      name: d.name,
      length: Number(d.length)
    };
  });

  xLengths.sort(function(a, b) {
    return a.length < b.length ? 1 : -1;
  });
  yLengths.sort(function(a, b) {
    return a.length < b.length ? 1 : -1;
  });

  var xNames = _.pluck(xLengths, 'name');
  var yNames = _.pluck(yLengths, 'name');

  var xCumBPCount = cumulative_counts(_.pluck(xLengths, 'length'));
  var yCumBPCount = cumulative_counts(_.pluck(yLengths, 'length'));

  var xShiftScale = d3.scale.ordinal().domain(xNames).range(xCumBPCount);
  var yShiftScale = d3.scale.ordinal().domain(yNames).range(yCumBPCount);

  // Compute absolute BP offset from chromosome and relative offset
  for (var i = 0; i < data.length; i++) {
    var group = data[i].data;
    var aChrom = group[0].chr1;
    var bChrom = group[0].chr2;
    var xShift = xShiftScale(aChrom);
    var yShift = yShiftScale(bChrom);
    for (var j = 0; j < group.length; j++) {
      var match = group[j];
      match.x1 = Number(match.start1) + xShift;
      match.x2 = Number(match.stop1) + xShift;
      match.y1 = Number(match.start2) + yShift;
      match.y2 = Number(match.stop2) + yShift;
      match.xmin = Math.min(match.x1, match.x2);
      match.xmax = Math.max(match.x1, match.x2);
      match.ymin = Math.min(match.y1, match.y2);
      match.ymax = Math.max(match.y1, match.y2);

      match.logKs = Math.log(Number(match.Ks));
    }
  }

  var xTotalBPs = _.last(xCumBPCount);
  var yTotalBPs = _.last(yCumBPCount);
  var width = 600;
  var height = width * (yTotalBPs / xTotalBPs);

  var field = 'logKs';

  // Combine all chunks
  data = _.flatten(_.pluck(data, 'data'));
  // clean data
  data = _.filter(data, function(d) {
    return isFinite(d[field]);
  });
  data = _.sortBy(data, function(d) {
    return -d[field];
  });

  var BPPerPixel = xTotalBPs / width;
  var base = 4;
  var numLevels = Math.ceil(Math.log(BPPerPixel) / Math.log(base));
  var levels = [];
  for (var i = 0; i < numLevels; i++) {
    var level = BPPerPixel / Math.pow(base, i);
    levels.push(level);
  }
  var merged = merge(data, field, levels);
  var bvh_nodes = bvh_build(data);
  var prevMergeIndex = 0;
  data = merged[0].sets;

  var xExtent = [0, xTotalBPs];
  var yExtent = [0, yTotalBPs];
  var xScale = d3.scale.linear().domain(xExtent).range([0, width]);
  var yScale = d3.scale.linear().domain(yExtent).range([height, 0]);
  var xScaleOriginal = d3.scale.linear().domain(xExtent).range([0, width]);
  var yScaleOriginal = d3.scale.linear().domain(yExtent).range([height, 0]);

  var zoom = d3.behavior.zoom().x(xScale).y(yScale).scaleExtent([1, 10000]).on('zoom', zoomed);

  var wholePlotExtent = [
    [0, 0],
    [1e15, 1e15]
  ];

  function resizeBrushBoundary() {
    var s = scaling;
    // Fix the brush extent cursor box sizes
    d3.select('.resize.e').select('rect')
      .attr('width', 6 / s).attr('x', -3 / s);
    d3.select('.resize.w').select('rect')
      .attr('width', 6 / s).attr('x', -3 / s);
    d3.select('.resize.n').select('rect')
      .attr('height', 6 / s).attr('y', -3 / s);
    d3.select('.resize.s').select('rect')
      .attr('height', 6 / s).attr('y', -3 / s);

    d3.select('.resize.nw').select('rect')
      .attr('width', 6 / s).attr('x', -3 / s)
      .attr('height', 6 / s).attr('y', -3 / s);
    d3.select('.resize.ne').select('rect')
      .attr('width', 6 / s).attr('x', -3 / s)
      .attr('height', 6 / s).attr('y', -3 / s);
    d3.select('.resize.se').select('rect')
      .attr('width', 6 / s).attr('x', -3 / s)
      .attr('height', 6 / s).attr('y', -3 / s);
    d3.select('.resize.sw').select('rect')
      .attr('width', 6 / s).attr('x', -3 / s)
      .attr('height', 6 / s).attr('y', -3 / s);
  }

  var brush = d3.svg.brush()
    .x(d3.scale.linear().domain([0, width]).range([0, width]))
    .y(d3.scale.linear().domain([0, height]).range([0, height]))
    .on('brush', function() {
      updatePlot(brush.extent(), false);
      resizeBrushBoundary();
    })
    .on('brushend', function() {
      if (brush.empty()) {
        updatePlot(wholePlotExtent, true);
      } else {
        updatePlot(brush.extent(), true);
      }
    });

  var svgPre = d3.select('body').append('svg')
    .attr('width', width)
    .attr('height', height)
    .classed('main', true)
    .append('g').attr('id', 'zoom-group')
    .call(zoom).on('mousedown.zoom', null); //disable panning
  var svg = svgPre.append('g').attr('id', 'data-group');

  var plotWidth = 600;
  var plotHeight = 600;
  var plot = d3.select('body').append('svg').classed('plot', true)
    .attr({
      width: plotWidth,
      height: plotHeight
    });

  // Grid lines
  svg.selectAll('.grid-vertical')
    .data(xCumBPCount).enter().append('path')
    .classed('grid-vertical', true)
    .attr('d', function(d) {
      var x = xScale(d);
      var y1 = 0;
      var y2 = height;
      return 'M ' + x + ' ' + y1 + ' L ' + x + ' ' + y2;
    });

  svg.selectAll('.grid-horizontal')
    .data(yCumBPCount).enter().append('path')
    .classed('grid-horizontal', true)
    .attr('d', function(d) {
      var y = yScale(d);
      var x1 = 0;
      var x2 = width;
      return 'M ' + x1 + ' ' + y + ' L ' + x2 + ' ' + y;
    });

  var wholePlotBBox = {
    xmin: 0,
    ymin: 0,
    xmax: 1e15,
    ymax: 1e15
  };

  var dataExtent = d3.extent(bvh_find(bvh_nodes, wholePlotBBox), function(d) { return d[field]; });
  var colorScale = d3.scale.linear().domain(dataExtent)
    .range(["red", "green"]);

  // Data
  var dataSel = svg.selectAll('.synteny').data(data).enter()
    .append('line')
    .classed('synteny', true)
    .attr('x1', function(d) {
      return xScale(d.x1);
    })
    .attr('y1', function(d) {
      return yScale(d.y1);
    })
    .attr('x2', function(d) {
      return xScale(d.x2);
    })
    .attr('y2', function(d) {
      return yScale(d.y2);
    })
    .style('stroke', function(d) {
      return colorScale(d.summary);
    });

  svgPre
    .append('g').attr('id', 'brush-group')
    .call(brush);

  var strokeWidth = 3;
  var lastScale = strokeWidth;

  var panning = false;
  var scaling = 1;
  var translation = [0, 0];

  function zoomed() {
    var t = d3.event.translate;
    var s = d3.event.scale;

    var modifiedXExtent = xScale.domain();
    var modifiedYExtent = yScale.domain();
    var screenWidth = modifiedXExtent[1] - modifiedXExtent[0]; // Ratio is same using x or y
    var original = xExtent[1] - xExtent[0];
    var plotScaling = strokeWidth * screenWidth / original;
    var gridScaling = screenWidth / original;


    var BP = BPPerPixel * gridScaling;
    var mergeIndex = 0;
    for (var i = levels.length - 1; i >= 0; i--) {
      if (BP < levels[i]) {
        mergeIndex = i;
        break;
      }
    }
    if (mergeIndex !== prevMergeIndex) {
      prevMergeIndex = mergeIndex;
      data = merged[mergeIndex].sets;
      var tempSel = svg.selectAll('.synteny').data(data);

      tempSel.enter().append('line').classed('synteny', true);

      tempSel
        .attr('x1', function(d) {
          return xScaleOriginal(d.x1);
        })
        .attr('y1', function(d) {
          return yScaleOriginal(d.y1);
        })
        .attr('x2', function(d) {
          return xScaleOriginal(d.x2);
        })
        .attr('y2', function(d) {
          return yScaleOriginal(d.y2);
        })
        .style('stroke', function(d) {
          return colorScale(d.summary);
        });

      tempSel.exit().remove();

      dataSel = tempSel;
    }


    t[0] = Math.min(0, Math.max(-width * s + width, t[0]));
    t[1] = Math.min(0, Math.max(-height * s + height, t[1]));
    translation = t;
    scaling = s;
    zoom.translate(t); // prevents the translate from growing large. This way, you don't have to "scroll back" onto the canvas if you go too far.

    d3.select('#brush-group').attr("transform", "translate(" + t + ")scale(" + d3.event.scale + ")");
    d3.select('#data-group').attr("transform", "translate(" + t + ")scale(" + d3.event.scale + ")");



    /* 
     * Two optimizations for semantic zooming:
     *  - Only update the stroke-width if there is a large difference
     *    between current width and ideal width.
     *    This lowers the number of updates that are necessary at low
     *    magnification, which are the most expensive because...
     *  - We only update the svg elements that are visible.
     *
     * The parameter k controls how extreme the first optimization is.
     * k = 1 means that 'large' means roughly an integer difference,
     * k = 2 means that 'large' means roughly a half integer difference, etc.
     * (I don't know what I am talking about here.)
     * Bigger k, smoother. Smaller k, faster.
     */
    var k = 3;
    if (Math.round(k / scaling) !== Math.round(k / lastScale)) {
      lastScale = plotScaling;
      var xMax = modifiedXExtent[1];
      var xMin = modifiedXExtent[0];
      var yMax = modifiedYExtent[1];
      var yMin = modifiedYExtent[0];
      var wMargin = 1e7; // fudge by a little bit to catch data that starts off screen and extends on screen
      dataSel
        .filter(function(d) {
          return d.x1 < xMax + wMargin && d.x1 > xMin - wMargin && d.y1 < yMax + wMargin && d.y1 > yMin - wMargin;
        })
        .style('stroke-width', plotScaling);
    }

    // There are so few grid lines, we can afford to update all of them
    // all of the time.
    d3.selectAll('.grid-horizontal').style('stroke-width', gridScaling);
    d3.selectAll('.grid-vertical').style('stroke-width', gridScaling);
  }

  var numTicks = 20;
  var margin = 50;

  // What a mess... d3.scale.linear.ticks decides how many ticks you get.
  // The param is only a hint. We need to get the right number of bars, 
  // so we make an axis just for that purpose. slice(1) deals with the 
  // fact that the histogram layout bins between the tick values: n ticks 
  // goes to n - 1 bins
  var tempScale = d3.scale.linear()
    .domain(dataExtent)
    .range([margin, plotWidth - margin]);
  plot.selectAll('.dataBars')
    .data(tempScale.ticks(numTicks).slice(1))
    .enter()
    .append('rect').classed('dataBars', true);
  addBins(bvh_nodes, field, tempScale.ticks(numTicks));

  plot.append('text')
    .attr('x', 2 * plotHeight / 3)
    .attr('width', plotHeight / 3)
    .attr('y', 50)
    .attr('height', 50)
    .classed('textInPlot', true)
    .text(field);

  function plotBrushBrush() {
    var e = plotBrush.extent();
    // Rounding to include entire histogram bars at once
    var min = Math.floor(numTicks * e[0]) / numTicks;
    var max = Math.ceil(numTicks * e[1]) / numTicks;
    svg.selectAll('.synteny').classed('selected', function(d) {
      return d[field] <= max && d[field] >= min;
    });
  }

  function plotBrushEnd() {
    if (plotBrush.empty()) {
      svg.selectAll('.synteny').classed('selected', false);
      //   plot.selectAll('.dataBars').attr('fill', 'steelblue');
    }
  }

  var lastYExtent = [0, bvh_nodes.data.length]; // Default--no reason why
  var plotBrush = d3.svg.brush()
    .on('brush', plotBrushBrush)
    .on('brushend', plotBrushEnd);
  var xPlotScale, yPlotScale;

  function updatePlot(extent, shouldRescaleYAxis) {
    var e = extent;
    e = [
      [xScaleOriginal.invert(e[0][0]), yScaleOriginal.invert(e[1][1])],
      [xScaleOriginal.invert(e[1][0]), yScaleOriginal.invert(e[0][1])],
    ];

    var bbox = {
      xmin: e[0][0],
      ymin: e[0][1],
      xmax: e[1][0],
      ymax: e[1][1]
    };

    var filteredData = bvh_find_summary(bvh_nodes, bbox);

    xPlotScale = d3.scale.linear()
      .domain(dataExtent)
      .range([margin, plotWidth - margin]);
    yPlotScale = d3.scale.linear()
      .domain(lastYExtent)
      .range([plotHeight - margin, margin]);

    var xAxis = d3.svg.axis().scale(xPlotScale).orient('bottom');
    var yAxis = d3.svg.axis().scale(yPlotScale).orient('left');

    plotBrush.x(xPlotScale);
    plot.selectAll('#plotbrush-group').remove();
    var gBrush = plot.append('g').attr('id', 'plotbrush-group')
      .attr('transform', 'translate(0,' + margin + ')')
      .call(plotBrush);
    gBrush.selectAll('rect').attr('height', plotHeight - 2 * margin);

    plot.selectAll('.dataBars').data(filteredData)
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
        return plotHeight - margin - yPlotScale(d.y);
      })
      .attr('fill', function(d) {
        return colorScale(d.x + d.dx / 2);
      });

    plotBrushBrush();

    plot.selectAll('.xAxis').remove();
    plot.selectAll('.yAxis').remove();

    plot.append('g')
      .attr('transform', 'translate(0,' + (plotHeight - 50) + ')')
      .classed('xAxis', true).call(xAxis);
    var yAxisSel = plot.append('g')
      .attr('transform', 'translate(50,0)')
      .classed('yAxis', true).call(yAxis);

    if (shouldRescaleYAxis) {
      var transitionLength = 750;

      lastYExtent = [0, 3 / 2 * d3.max(_.pluck(filteredData, 'y'))];
      yPlotScale = d3.scale.linear()
        .domain(lastYExtent)
        .range([plotHeight - margin, margin]);
      yAxis.scale(yPlotScale);
      yAxisSel.transition().duration(transitionLength).call(yAxis);
      plot.selectAll('.dataBars').transition().duration(transitionLength)
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
          return plotHeight - margin - yPlotScale(d.y);
        });
    }
  }

  updatePlot(wholePlotExtent, true); // Initialize histogram

  // zoom/pan switching
  d3.selectAll("#mouse-options input[name=mouse-options]")
    .on("change", function() {
      if (this.value === 'pan') {
        panning = true;
        d3.select('#brush-group').on('mousedown.brush', null);
        d3.select('#zoom-group').call(zoom);
        d3.select('#brush-group').style('pointer-events', null);
        d3.select('#zoom-group').style('pointer-events', 'all');
      } else if (this.value === 'brush') {
        panning = false;
        d3.select('#brush-group').call(brush);
        d3.select('#brush-group').style('pointer-events', 'all');
        d3.select('#zoom-group').on('mousedown.zoom', null);
      }
    });
});


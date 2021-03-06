'use strict';

const histogram = require('./histogram');
const dotplot = require('./dotplot');
const _ = require('lodash');
const d3 = require('d3');
const autoscale = require('./auto-colorscale');

require('./style.css');

const {
  RUN_BENCHMARKS,
  SHOW_MAXIMA_AND_MINIMA
} = require('constants');

function buildDiv(element_id, show_histograms) {
  const div = d3.select(element_id)
    .append('div')
    .classed('_synteny-dotplot-builder', true);

  div.append('svg').attr('id', 'dotplot').classed('dotplot', true);

  const subdiv = div.append('div').classed('dotplot', true);
  /* pointer-events = none stops the canvas from intercepting brush events
   * before they get to the svg element below. */
  subdiv.append('canvas')
    .attr('id', 'dotplot-canvas-background').classed('dotplot', true)
    .style('pointer-events', 'none');
  subdiv.append('canvas')
    .attr('id', 'dotplot-canvas').classed('dotplot', true)
    .style('pointer-events', 'none');

  const histogramWrapper = div.append('div').attr('id', 'histogram-wrapper');
  histogramWrapper.append('svg').attr('id', 'plot').classed('histogram', true);
  histogramWrapper.append('svg').attr('id', 'plot2').classed('histogram', true);
  histogramWrapper.append('svg').attr('id', 'plot3').classed('histogram', true);

  const formWrapper = div.append('div').attr('id', 'form-wrapper');
  function makeForm(title, optionId, elements, checkIndex) {
    const navOptions = formWrapper
      .append('div')
      .classed('radio-button-box', true);
    navOptions.append('strong').text(title + ': ');

    const navForm = navOptions.append('form').attr('id', optionId);
    const options = navForm.selectAll('input')
      .data(elements).enter().append('input')
      .attr('type', 'radio').attr('name', optionId)
      .attr('value', d => d[0]);

    options.forEach(function(selection) {
      selection.forEach(function(element, i) {
        const label = document.createElement('label');
        label.textContent = elements[i][1];
        navForm.node().insertBefore(label, element);
      });
    });
    options[0][checkIndex].checked = true;
  }

  if (show_histograms) {
    const buttonWrapper = formWrapper
      .append('div')
      .classed('histogram-button-wrapper', true);
    ['log(ks)', 'log(kn/ks)', 'log(kn)'].forEach(form => {
      buttonWrapper.append('button')
        .classed('histogram-button', true)
        .attr('id', `histogram-button-${form.replace(/[\(\)\/]/g, '')}`, true)
        .text(form);
    });

    const option = (value, text) => [value, text];

    makeForm('Navigation Mode', 'mouse-options', [
      option('brush', 'Brushing'),
      option('pan', 'Panning')
    ], 0);

    makeForm('Color Scale', 'color-options', [
      option('auto', 'auto'),
      option('rainbow_quantized', 'rainbow_quantized')
    ], 0);

    const persistenceOptions = formWrapper
      .append('div')
      .classed('radio-button-box', true);
    persistenceOptions.append('strong').text('Auto-scale sensitivity: ');

    persistenceOptions
      .append('input')
      .attr('id', 'persistence')
      .attr('type', 'range')
      .attr('min', 0)
      .attr('max', 100)
      .attr('value', 40)
      .attr('step', 1);

    persistenceOptions
      .append('label')
      .attr('id', 'persistence-text')
      .text('40');
  }
  const gevoLink = formWrapper.append('div');
  gevoLink
    .append('a')
    .attr('id', 'gevo-link')
    .text('GeVO Link')
    .attr('href', '#');
  gevoLink.append('div').attr('id', 'gevo-link-xname');
  gevoLink.append('div').attr('id', 'gevo-link-yname');
}

function controller(dataObj, element_id, meta) {

  buildDiv('#' + element_id, meta.have_ks);

  const refreshPlot = _.debounce(function(colorScale) {
    syntenyPlot.setColorScale(colorScale);
  }, 100);

  const refreshAutoScale = _.throttle(function(persistence) {
    const radio = document.getElementById('color-options');
    const auto = _.find(radio.children, {value: 'auto'});
    auto.checked = true;

    const bins = histograms[activeField].bins();
    const newAutoScale = autoscale.generateAutoScale(bins, persistence);

    histograms[activeField].setColorScale(newAutoScale);
    refreshPlot(newAutoScale);

    if (SHOW_MAXIMA_AND_MINIMA)
      _.each(histograms, h => h.updateMinMaxMarkers(persistence));
  }, 50);

  const getPersistence = () => d3.select('#persistence').node().value;

  d3.select('#persistence')
    .on('input', function() {
      const p = getPersistence();
      refreshAutoScale(p);
      d3.select('#persistence-text').node().innerText = p;
    });

  /* zoom/pan switching */
  d3.selectAll('#mouse-options input[name=mouse-options]')
    .on('change', function() {
      syntenyPlot.setNavMode(this.value);
    });

  /* color mode switching */
  var activeField = 'logks';

  /* Don't be cute and use fat arrow functions here. Fat arrow functions
   * have a lexically bound "this" and we really really need the old "this"
   * scoping, since we are getting value from a form. */
  d3.selectAll('#color-options input[name=color-options]')
    .on('change', function() {
      var newCS;
      if (this.value === 'auto') {
        newCS = autoscale.generateAutoScale(
          histograms[activeField].bins(), getPersistence());
      } else {
        newCS = colorScale(activeField, this.value);
      }
      histograms[activeField].setColorScale(newCS);
      syntenyPlot.setColorScale(newCS);
    });

  const colorScale = require('colorscales').onData(dataObj.currentData().raw);

  const initial = colorScale(activeField, 'rg');

  if (!meta.have_ks) {
    const scale = colorScale(activeField, 'unselected');
    const synteny = dotplot.synteny;
    const syntenyPlot = synteny('#dotplot', dataObj, 'logks', scale, meta);
    return;
  }

  const histograms = {
    'logks': histogram.histogram('#plot', dataObj, 'logks', initial),
    'logkn': histogram.histogram('#plot2', dataObj, 'logkn', initial),
    'logknks': histogram.histogram('#plot3', dataObj, 'logknks', initial)
  };
  const activePlot = histograms[activeField];
  const initialAutoScale = autoscale.generateAutoScale(activePlot.bins(),
    getPersistence());
  activePlot.setColorScale(initialAutoScale);
  _(histograms)
    .toPairs()
    .filter(([name]) => name !== activeField)
    .forEach(([name, plot]) => plot.setColorScale(
      colorScale(name, 'unselected')));

  const syntenyPlot = dotplot.synteny('#dotplot', dataObj, 'logks',
    initialAutoScale, meta);

  //FIXME
  const name_map = {
    'logks': 'plot',
    'logkn': 'plot2',
    'logknks': 'plot3'
  };
  _.keys(histograms).forEach(name => {
    d3.select('#histogram-button-' + name)
      .on('click', () => {
        d3.selectAll('.histogram').classed('hidden', true);
        d3.select('#' + name_map[name]).classed('hidden', false);
        d3.selectAll('.histogram-button').classed('pressed', false);
        d3.select('#histogram-button-' + name).classed('pressed', true);
        activeField = name;
        refreshAutoScale(getPersistence());
      });
  });

  d3.selectAll('.histogram').classed('hidden', true);
  d3.select('#' + name_map[activeField]).classed('hidden', false);
  d3.selectAll('.histogram-button').classed('pressed', false);
  d3.select('#histogram-button-' + activeField).classed('pressed', true);

  // Since the histograms aren't controlling their own color scale policy 
  // now (a good thing), we need to manually fire of their update methods. 
  // Eventually, we should fix this up.
  dataObj.addListener(function(typeHint) {
    if (typeHint.indexOf('stop') > -1 && SHOW_MAXIMA_AND_MINIMA)
      _.each(histograms, h => h.updateMinMaxMarkers(getPersistence()));
  });
  dataObj.notifyListeners('initial');

  /* Benchmark */
  if (RUN_BENCHMARKS) {
    const [minLogKs, maxLogKs] = d3.extent(
      dataObj.currentData().raw, x => x.logks);
    const points = _.range(minLogKs, maxLogKs, (maxLogKs - minLogKs) / 10);

    const rangeList = _.chain(points)
      .map(lo => _.map(points, hi => [lo, hi]))
      .flatten()
      .filter(([lo, hi]) => lo < hi)
      .value();

    const asyncBenchmark = require('async-benchmark');
    asyncBenchmark.benchmark(rangeList, function(range) {
      histograms.logks.brush.extent(range);
      histograms.logks.brush.event(histograms.logks.selection);
    }, function({average, max}) {
      alert('Average: ' + average + ', max: ' + max);
    });
  }
}

exports.controller = controller;

// Local Variables:
// mode: js2
// js2-basic-offset: 8
// End:

import d3 from 'd3';
import queue from 'd3-queue';
import sv from './synteny-vis';
import { timeIt, zipObject } from './utils';
import { genCogeSequenceLink } from './coge-util';
import { inlineKSData,
         chromosomesToCumulativeBPCounts } from './chromosomeUtils.js';
import { createDataObj } from './dataObject';

exports.makeSyntenyDotPlot = function({
  data_url,
  spa_url,
  element_id,
  genome_x,
  genome_y,
  gen_coge_seq_link
}) {
  if (gen_coge_seq_link === undefined) {
    gen_coge_seq_link = genCogeSequenceLink;
  }

  var q = queue.queue();

  if (data_url === undefined) {
    console.error('Error - makeSyntenyDotPlot expects data_url parameter');
    return;
  }
  q = q.defer(d3.text, data_url);

  // default modes
  var mode = {
    withSpa: false,
    withKs: true
  };
  
  if (spa_url !== undefined) {
    q = q.defer(d3.text, spa_url);
    mode.withSpa = true;
  }

  if (!data_url.endsWith('.ks')) {
    mode.withKs = false;
  }

  q.await(function(err, ks, spa) {
    if (err) {
      console.error(err);
      return;
    }

    // Dirty hacks to make files with no ks work:
    if (!mode.withKs) {
      const random = () => Math.random() * 3 + 2;
      ks = ks.split('\n')
        .map(x => x[0] === '#' ? x : `${random()},${random()},` + x)
        .join('\n');
    }

    const ksData = ksTextToObjects(ks);
    if (mode.withSpa) {
      var newChromosomeIds = {};
      var remapInstructions = {};
      var newChrMeta = {};
      spa = spa.split('\n');

      var genomeYById = {};
      genome_y.chromosomes.forEach(function(c) {
        genomeYById[c.name] = c;
      });
      for (var i=1; i<spa.length; ++i) {
        var xChr, yChr;
        var line = spa[i].split('\t');
        var newYName;
        if (line.length === 3) {
          // this is an actual SPA assignment
          xChr = line[0];
          yChr = line[1];
          var direction = line[2];
          newYName = 'SPA_' + xChr;
          
          if (!(newYName in newChromosomeIds)) {
            newChromosomeIds[newYName] = {
              offset: 0
            };
            newChrMeta[newYName] = {
              length: 0,
              CDS_count: 0,
              gene_count: 0,
              name: newYName
            };
          }
          var newChromosome = newChromosomeIds[newYName];
          var localOffset;
          var oldChromosomeLength = genomeYById[yChr].length;
          newChrMeta[newYName].length += genomeYById[yChr].length;
          // I don't think we're using this, but hey.
          newChrMeta[newYName].CDS_count += genomeYById[yChr].CDS_count;
          newChrMeta[newYName].gene_count += genomeYById[yChr].gene_count;
          if (direction === '-1') {
            remapInstructions[yChr] = {
              slope: -1,
              intercept: newChromosome.offset + oldChromosomeLength,
              name: newYName
            };
          } else {
            remapInstructions[yChr] = {
              slope: 1,
              intercept: newChromosome.offset,
              name: newYName
            };
          }
          newChromosome.offset += oldChromosomeLength;
        } else if (line.length === 2) {
          // this is an unmapped SPA assignment
          xChr = line[0];
          yChr = line[1];
          newYName = 'SPA_unmapped_' + yChr;
          
          remapInstructions[yChr] = {
            slope: 1,
            intercept: 0,
            name: newYName
          };
          var oldMeta = genomeYById[yChr];
          newChrMeta[newYName] = {
            length: oldMeta.length,
            CDS_count: oldMeta.CDS_count,
            gene_count: oldMeta.gene_count,
            name: newYName
          };
        }
      }
      ksData.forEach(function(d) {
        var i = remapInstructions[d.y_chromosome_id];
        if (i === undefined) return;
        d.y_chromosome_id = i.name;
        d.y_relative_offset = d.y_relative_offset * i.slope + i.intercept;
      });
      
      genome_y = {
        name: '(SPA) ' + genome_y.name,
        id: genome_y.id,
        chromosomes: Object.values(newChrMeta)
      };
    }

    const x_name = genome_x.name;
    const y_name = genome_y.name;
    var have_ks = mode.withKs;
    const meta = {
      genome_x,
      genome_y,
      x_name,
      y_name,
      have_ks,
      gen_coge_seq_link
    };
    
    sv.controller(ksData, element_id, meta);
  });
};

function ksTextToObjects(text) {
  /* .ks files are delimited with a combination of tabs and double bars. */
  const csvLines = text
    .replace(/\|\|/g, ',')
    .replace(/\t/g, ',')
    .replace(' ', '')
    .split('\n');

  const dots = csvLines
    .filter(line => line && line[0] !== '#')
    .map(ksLineToSyntenyDot)
    .filter(x => x);

  var min_logks, min_logkn;
  // Don't use "Math.min(...dots)" here because that
  // causes a stack overflow on large datasets.
  dots.forEach(line => {
    if (isFinite(line.logks)) {
      if (min_logks === undefined || line.logks < min_logks) {
        min_logks = line.logks;
      }
    }
    if (isFinite(line.logkn)) {
      if (min_logkn === undefined || line.logkn < min_logkn) {
        min_logkn = line.logkn;
      }
    }
  });

  return dots.map(x => {
    x.logks = isFinite(x.logks) ? x.logks : min_logks;
    x.logkn = isFinite(x.logkn) ? x.logkn : min_logkn;
    x.logknks = x.logkn - x.logks;
    return x;
  });
}

function ksLineToSyntenyDot(line) {
  const fields = line.split(',');

  if(fields[0] === 'NA' || fields[1] === 'NA') {
    return undefined;
  }

  const ks = Number(fields[0]);
  const kn = Number(fields[1]);
  const log10 = n => Math.log(n) / Math.log(10);

  return {
    ks,
    logks: log10(ks),
    kn,
    logkn: log10(kn),
    logknks: log10(kn) - log10(ks),
    x_chromosome_id: fields[3],
    y_chromosome_id: fields[15],
    x_feature_id: fields[9],
    y_feature_id: fields[21],
    x_relative_offset: Math.round((Number(fields[4]) + Number(fields[5])) / 2),
    y_relative_offset: Math.round((Number(fields[16]) + Number(fields[17])) / 2)
  };
}




/* Local Variables:  */
/* mode: js2         */
/* js2-basic-offset: 2 */
/* End:              */

// Dev-only gallery: `vite` with root at this folder. ?theme=dark|light forces a theme.
import { render } from 'preact';
import {
  Bars,
  ConvergenceChart,
  FanChart,
  Histogram,
  OverlayHistogram,
  Sparkline,
  SurvivalChart,
  SweepChart,
  categoryRows,
  stageRows,
} from '../index';
import {
  breakdownFixture,
  convergenceFixture,
  equityFixture,
  fanFixture,
  histogramFixture,
  survivalFixture,
  sweepFixture,
} from '../__fixtures__/data';
import './gallery.css';

const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

function Gallery() {
  const h = histogramFixture();
  const h2 = histogramFixture(3);
  const fan = fanFixture();
  const breakdown = breakdownFixture();
  const slow = { ...fan, p50: fan.p5 };
  return (
    <main>
      <h1>
        Charts <Sparkline values={equityFixture()} label="Equity" baseline={500000} />
      </h1>
      <section class="card" id="histogram">
        <Histogram histogram={h} title="Net result per session" />
      </section>
      <section class="card" id="overlay">
        <OverlayHistogram
          title="Compare: net result per session"
          lo={h.lo}
          width={h.width}
          markers={h.markers}
          series={[
            { id: 'flat', label: 'Flat red', counts: h.counts },
            { id: 'mart', label: 'Martingale', counts: h2.counts },
          ]}
        />
      </section>
      <section class="card wide" id="fan">
        <FanChart fan={fan} title="Paths over 500 rounds" />
      </section>
      <section class="card" id="fan-compare">
        <FanChart
          fan={fan}
          label="Flat red"
          overlays={[{ id: 'm', label: 'Martingale', rounds: slow.rounds, p50: slow.p50 }]}
          title="Median paths, compared"
        />
      </section>
      <section class="card" id="survival">
        <SurvivalChart survival={survivalFixture()} title="Share of sessions still playing" />
      </section>
      <section class="card" id="convergence">
        <ConvergenceChart
          convergence={convergenceFixture()}
          title="Mean net as sessions accumulate"
          expectedNet={-14000}
        />
      </section>
      <section class="card" id="convergence-bust">
        <ConvergenceChart
          convergence={convergenceFixture()}
          metric="bust"
          title="P(bust) as sessions accumulate"
        />
      </section>
      <section class="card" id="sweep">
        <SweepChart sweep={sweepFixture()} parameterLabel="Unit" />
      </section>
      <section class="card" id="sweep-cat">
        <SweepChart
          sweep={sweepFixture('categorical')}
          parameterLabel="Strategy"
          titlePrefix="Compare"
        />
      </section>
      <section class="card" id="bars-category">
        <Bars title="Net by bet category" valueLabel="Net" signed rows={categoryRows(breakdown)} />
      </section>
      <section class="card" id="bars-stage">
        <Bars title="Net by stage" valueLabel="Net" signed rows={stageRows(breakdown)} />
      </section>
    </main>
  );
}

render(<Gallery />, document.getElementById('root')!);

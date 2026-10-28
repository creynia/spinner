// NotFound: any unknown address.
import { Button, Card } from '@core/ui';
import { href } from '../../router';

export function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <Card title="Nothing here">
        <p>That address does not match any screen.</p>
        <Button variant="primary" href={href('/')}>
          Go to the home screen
        </Button>
      </Card>
    </>
  );
}

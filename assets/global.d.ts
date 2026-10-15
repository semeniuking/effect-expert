interface Window {
  Theme: {
    routes: Record<string, string>;
    cartType: 'drawer' | 'page';
    moneyFormat: string;
    locale: string;
    strings: Record<string, string>;
  };
  Shopify?: any;
}

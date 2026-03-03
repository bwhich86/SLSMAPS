export type LayerKind = 'EXTERIOR_PLAN'|'EXTERIOR_AERIAL'|'INTERIOR_PLAN';
export type LayerType = 'pdf'|'image';

export type Layer = {
  name: string;
  kind: LayerKind;
  type: LayerType;
  fileId: string;
  pageIndex?: number;
};

export type AssetCategory = 'LIGHTING'|'ELECTRICAL';

export type Asset = {
  id: string;
  category: AssetCategory;
  typeCode: string;
  layerName: string;
  x: number;
  y: number;
  zone?: string;
  notes?: string;
  utilityId?: string;
};

export type Status = 'OK'|'OUT'|'DIM'|'FLICKER'|'DAMAGED'|'NA';

export type Result = {
  assetId: string;
  status: Status;
  notes?: string;
  photos?: { fileId: string; name: string }[];
  updatedAt: string;
};

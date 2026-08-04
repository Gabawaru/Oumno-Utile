// Paquet XMP pour PDF/A-3 + Factur-X.
// Deux exigences se combinent ici :
//  - PDF/A-3 : identifiants pdfaid:part=3 / conformance=B, dates cohérentes
//    avec le dictionnaire Info du PDF ;
//  - Factur-X : schéma d'extension déclaré (obligatoire en PDF/A pour tout
//    schéma non prédéfini) + propriétés fx: décrivant le XML embarqué.

const escXml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {object} o
 * @param {string} o.title        titre du document (ex. "Facture F-2026-0001")
 * @param {string} o.author       émetteur
 * @param {string} o.producer     nom du logiciel
 * @param {string} o.dateIso      date ISO 8601 avec fuseau (ex. 2026-08-04T12:00:00+00:00)
 * @param {boolean} o.facturx     inclure les métadonnées Factur-X
 * @param {string} o.facturxType  "INVOICE"
 */
export function buildXmp({ title, author, producer, dateIso, facturx = false, facturxType = 'INVOICE' }) {
  const fxBlock = facturx
    ? `
  <rdf:Description rdf:about=""
      xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
      xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
      xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
    <pdfaExtension:schemas>
      <rdf:Bag>
        <rdf:li rdf:parseType="Resource">
          <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
          <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
          <pdfaSchema:prefix>fx</pdfaSchema:prefix>
          <pdfaSchema:property>
            <rdf:Seq>
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>Name of the embedded XML invoice file</pdfaProperty:description>
              </rdf:li>
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>DocumentType</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>INVOICE</pdfaProperty:description>
              </rdf:li>
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>Version</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description>
              </rdf:li>
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description>
              </rdf:li>
            </rdf:Seq>
          </pdfaSchema:property>
        </rdf:li>
      </rdf:Bag>
    </pdfaExtension:schemas>
  </rdf:Description>
  <rdf:Description rdf:about=""
      xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
    <fx:DocumentType>${facturxType}</fx:DocumentType>
    <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
    <fx:Version>1.0</fx:Version>
    <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
  </rdf:Description>`
    : '';

  const xml = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
    <pdfaid:part>3</pdfaid:part>
    <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:format>application/pdf</dc:format>
    <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escXml(title)}</rdf:li></rdf:Alt></dc:title>
    <dc:creator><rdf:Seq><rdf:li>${escXml(author)}</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
    <xmp:CreatorTool>${escXml(producer)}</xmp:CreatorTool>
    <xmp:CreateDate>${dateIso}</xmp:CreateDate>
    <xmp:ModifyDate>${dateIso}</xmp:ModifyDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
    <pdf:Producer>${escXml(producer)}</pdf:Producer>
  </rdf:Description>${fxBlock}
 </rdf:RDF>
</x:xmpmeta>
${' '.repeat(2048).replace(/(.{64})/g, '$1\n')}<?xpacket end="w"?>`;
  return Buffer.from(xml, 'utf8');
}

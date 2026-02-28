import { Project, SyntaxKind, type JsxAttributeLike, type JsxElement, type JsxSelfClosingElement } from 'ts-morph';
import type { InjectIdsResult, InjectionResult } from './types.js';

function isJsxElement(
  element: JsxElement | JsxSelfClosingElement
): element is JsxElement {
  return element.getKind() === SyntaxKind.JsxElement;
}

function getOpeningElement(
  element: JsxElement | JsxSelfClosingElement
) {
  if (isJsxElement(element)) {
    return element.getOpeningElement();
  }
  return element;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function hasIdProp(attributes: JsxAttributeLike[]): boolean {
  return attributes.some((attr) => {
    if ('getNameNode' in attr && typeof attr.getNameNode === 'function') {
      return attr.getNameNode().getText() === 'id';
    }
    return false;
  });
}

function findDuplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }

  return Array.from(duplicates);
}

export function injectIds(
  code: string,
  existingIds: Set<string>,
  designName: string
): InjectIdsResult {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('temp.tsx', code);

  const slugifiedName = slugify(designName);
  let counter = 0;
  const injectedIds = new Set<string>();
  const allIds = new Set<string>(existingIds);

  const jsxElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement);
  const jsxSelfClosingElements = sourceFile.getDescendantsOfKind(
    SyntaxKind.JsxSelfClosingElement
  );

  let unchanged = 0;

  for (const element of jsxElements) {
    const openingElement = element.getOpeningElement();
    if (!openingElement) continue;

    const attributes = openingElement.getAttributes();

    if (hasIdProp(attributes)) {
      unchanged++;
      continue;
    }

    let id: string;
    do {
      id = `id_${slugifiedName}_${counter}`;
      counter++;
    } while (allIds.has(id));

    openingElement.addAttributes([{ name: 'id', initializer: `"${id}"` }]);

    injectedIds.add(id);
    allIds.add(id);
  }

  for (const element of jsxSelfClosingElements) {
    const attributes = element.getAttributes();

    if (hasIdProp(attributes)) {
      unchanged++;
      continue;
    }

    let id: string;
    do {
      id = `id_${slugifiedName}_${counter}`;
      counter++;
    } while (allIds.has(id));

    element.addAttributes([{ name: 'id', initializer: `"${id}"` }]);

    injectedIds.add(id);
    allIds.add(id);
  }

  const allJsxElements = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  const currentIds: string[] = [];
  for (const element of allJsxElements) {
    const openingElement = getOpeningElement(element);

    if (!openingElement) continue;

    const idAttr = openingElement.getAttribute('id');
    if (idAttr && 'getInitializer' in idAttr) {
      const value = idAttr.getInitializer()?.getText().replace(/["']/g, '');
      if (value) {
        currentIds.push(value);
      }
    }
  }

  const duplicates = findDuplicateIds(currentIds);
  let removed = 0;

  if (duplicates.length > 0) {
    for (const element of allJsxElements) {
      const openingElement = getOpeningElement(element);

      if (!openingElement) continue;

      const idAttr = openingElement.getAttribute('id');
      if (idAttr && 'getInitializer' in idAttr) {
        const value = idAttr.getInitializer()?.getText().replace(/["']/g, '');
        if (value && duplicates.includes(value)) {
          const duplicateCount = currentIds.filter((id) => id === value).length;
          if (duplicateCount > 1) {
            idAttr.remove();
            removed++;

            let newId: string;
            do {
              newId = `id_${slugifiedName}_${counter}`;
              counter++;
            } while (allIds.has(newId));

            openingElement.addAttributes([{ name: 'id', initializer: `"${newId}"` }]);

            injectedIds.add(newId);
            allIds.add(newId);
            currentIds[currentIds.indexOf(value)] = newId;
          }
        }
      }
    }
  }

  const updatedCode = sourceFile.getFullText();

  const result: InjectionResult = {
    added: injectedIds.size,
    removed,
    duplicates: duplicates.length,
    unchanged,
  };

  return {
    code: updatedCode,
    result,
  };
}
